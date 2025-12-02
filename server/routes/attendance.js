const express = require('express');
const Attendance = require('../models/Attendance');
const auth = require('../middleware/auth');
const pesuScraper = require('../services/pesuScraper');
const cheerio = require('cheerio');

const router = express.Router();

/**
 * Extract menuId and controllerMode from profile page HTML
 * @param {cheerio.CheerioAPI} $ - Cheerio instance loaded with profile HTML
 * @param {string} menuNameKeyword - Keyword to search for in menu name (e.g., 'courses', 'attendance')
 * @returns {Object} { menuId, controllerMode }
 */
function extractMenuInfo($, menuNameKeyword) {
  let menuId = null;
  let controllerMode = null;
  
  const menuUl = $('#studentProfilePESUHomeMenu');
  if (menuUl.length > 0) {
    menuUl.find('li').each((i, elem) => {
      const menuName = $(elem).find('.menu-name').text().trim();
      if (menuName && menuName.toLowerCase().includes(menuNameKeyword.toLowerCase())) {
        // Extract menuId from id attribute: menuTab_660 -> 660
        const idAttr = $(elem).attr('id') || '';
        const menuIdMatch = idAttr.match(/menuTab_(\d+)/);
        if (menuIdMatch) {
          menuId = menuIdMatch[1];
        }
        
        // Extract controllerMode from data-url: "studentProfilePESUAdmin/MyAttendance/6407/5" -> 6407
        const dataUrl = $(elem).attr('data-url') || '';
        const urlParts = dataUrl.split('/');
        if (urlParts.length >= 3) {
          const possibleControllerMode = urlParts[urlParts.length - 2]; // Second to last part
          if (possibleControllerMode && /^\d+$/.test(possibleControllerMode)) {
            controllerMode = possibleControllerMode;
          }
        }
      }
    });
  }
  
  return { menuId, controllerMode };
}

// Get attendance for a semester
router.get('/:semester', auth, async (req, res) => {
  try {
    const { semester } = req.params;
    const attendance = await Attendance.find({
      userId: req.user._id,
      semester: parseInt(semester)
    });

    // Calculate overall stats
    let totalClasses = 0;
    let totalAttended = 0;
    attendance.forEach(att => {
      totalClasses += att.totalClasses;
      totalAttended += att.attendedClasses;
    });

    const overallPercentage = totalClasses > 0 
      ? Math.round((totalAttended / totalClasses) * 100) 
      : 0;

    res.json({
      attendance,
      overall: {
        totalClasses,
        totalAttended,
        percentage: overallPercentage
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update attendance
router.post('/', auth, async (req, res) => {
  try {
    const { semester, subjectCode, subjectName, totalClasses, attendedClasses } = req.body;
    
    const percentage = totalClasses > 0 
      ? Math.round((attendedClasses / totalClasses) * 100) 
      : 0;

    const attendance = await Attendance.findOneAndUpdate(
      {
        userId: req.user._id,
        semester,
        subjectCode
      },
      {
        subjectName,
        totalClasses,
        attendedClasses,
        percentage
      },
      { upsert: true, new: true }
    );

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to compare attendance data
function attendanceDataEqual(oldData, newData) {
  if (!oldData || !newData || oldData.length !== newData.length) {
    return false;
  }
  
  const oldMap = new Map();
  oldData.forEach(att => {
    oldMap.set(att.subjectCode, {
      attendedClasses: att.attendedClasses,
      totalClasses: att.totalClasses,
      percentage: att.percentage
    });
  });
  
  for (const newAtt of newData) {
    const oldAtt = oldMap.get(newAtt.subjectCode);
    if (!oldAtt) return false;
    if (oldAtt.attendedClasses !== newAtt.attendedClasses ||
        oldAtt.totalClasses !== newAtt.totalClasses ||
        Math.abs(oldAtt.percentage - newAtt.percentage) > 0.01) {
      return false;
    }
  }
  
  return true;
}

// Get raw HTML for attendance (for frontend scraping)
router.get('/html/:semesterId', auth, async (req, res) => {
  try {
    const { semesterId, semester } = req.params;
    const targetSemesterId = semesterId || semester;
    if (!targetSemesterId) {
      return res.status(400).json({ error: 'Semester ID is required' });
    }
    
    // Try to determine semester number from semesterId
    const semesterNumber = parseInt(targetSemesterId, 10);
    
    // Check for cached attendance first
    const cachedAttendance = await Attendance.find({
      userId: req.user._id,
      semester: semesterNumber
    });
    
    // If we have cached data, parse it and return HTML representation
    if (cachedAttendance && cachedAttendance.length > 0) {
      // Build HTML table from cached data
      let html = '<table class="table box-shadow" style="margin-bottom: 10px;"><thead><th>Course Code</th><th>Course Name</th><th>Total Classes</th><th>Percentage(%)</th></thead><tbody id="subjetInfo">';
      cachedAttendance.forEach(att => {
        html += `<tr><td>${att.subjectCode}</td><td>${att.subjectName}</td><td>${att.attendedClasses}/${att.totalClasses}</td><td>${Math.round(att.percentage)}</td></tr>`;
      });
      html += '</tbody></table>';
      
      res.set('Content-Type', 'text/html');
      return res.send(html);
    }
    
    // No cache, fetch from PESU
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }
    
    try {
      const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
      
      // Dynamically extract menuId and controllerMode from profile page HTML
      const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
      const $profile = cheerio.load(profileResp.data);
      const { menuId, controllerMode } = extractMenuInfo($profile, 'attendance');
      
      if (!menuId || !controllerMode) {
        return res.status(500).json({ error: 'Could not extract attendance menu information from PESU Academy' });
      }
      
      const html = await pesuScraper.getAttendanceHtml(session, targetSemesterId, menuId, controllerMode);
      
      // Parse and cache the attendance data
      const $ = cheerio.load(html);
      const attendanceData = [];
      const table = $('table.table.box-shadow');
      const tbody = table.find('tbody#subjetInfo');
      
      if (tbody.length > 0) {
        tbody.find('tr').each((i, row) => {
          const tds = $(row).find('td');
          if (tds.length >= 4) {
            const subjectCode = $(tds[0]).text().trim();
            const subjectName = $(tds[1]).text().trim();
            const totalClassesText = $(tds[2]).text().trim();
            const classesMatch = totalClassesText.match(/(\d+)\s*\/\s*(\d+)/);
            const attendedClasses = classesMatch ? parseInt(classesMatch[1]) : 0;
            const totalClasses = classesMatch ? parseInt(classesMatch[2]) : 0;
            const percentage = totalClasses > 0 ? (attendedClasses / totalClasses) * 100 : 0;
            
            if (subjectCode && subjectName) {
              attendanceData.push({
                subjectCode,
                subjectName,
                attendedClasses,
                totalClasses,
                percentage
              });
            }
          }
        });
      }
      
      // Only update cache if data differs
      if (attendanceData.length > 0) {
        const oldData = cachedAttendance.map(att => ({
          subjectCode: att.subjectCode,
          attendedClasses: att.attendedClasses,
          totalClasses: att.totalClasses,
          percentage: att.percentage
        }));
        
        if (!attendanceDataEqual(oldData, attendanceData)) {
          // Update cache
          for (const att of attendanceData) {
            await Attendance.findOneAndUpdate(
              {
                userId: req.user._id,
                semester: semesterNumber,
                subjectCode: att.subjectCode
              },
              {
                subjectName: att.subjectName,
                totalClasses: att.totalClasses,
                attendedClasses: att.attendedClasses,
                percentage: att.percentage
              },
              { upsert: true, new: true }
            );
          }
        }
      }
      
      res.set('Content-Type', 'text/html');
      res.send(html);
    } catch (loginError) {
      if (loginError.message.includes('session expired') || loginError.message.includes('Login failed')) {
        return res.status(401).json({ error: 'PESU Academy login failed. Your credentials may have changed. Please login again.' });
      }
      throw loginError;
    }
  } catch (error) {
    console.error('Error fetching attendance HTML:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch attendance' });
  }
});

// Sync attendance from PESU Academy
router.post('/sync', auth, async (req, res) => {
  try {
    const { semesterId, semester, semesterNumber } = req.body;
    const targetSemesterId = semesterId || semester;
    const targetSemesterNumber = semesterNumber || (semester ? parseInt(semester, 10) : null);
    
    if (!targetSemesterId) {
      return res.status(400).json({ error: 'Semester ID is required' });
    }
    
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }
    
    try {
      const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
      
      // Dynamically extract menuId and controllerMode from profile page HTML
      const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
      const $profile = cheerio.load(profileResp.data);
      const { menuId, controllerMode } = extractMenuInfo($profile, 'attendance');
      
      if (!menuId || !controllerMode) {
        return res.status(500).json({ error: 'Could not extract attendance menu information from PESU Academy' });
      }
      
      const html = await pesuScraper.getAttendanceHtml(session, targetSemesterId, menuId, controllerMode);
      const $ = cheerio.load(html);
      
      // Parse attendance table - matches exact structure: table.table.box-shadow with tbody#subjetInfo
      const attendanceData = [];
      const table = $('table.table.box-shadow');
      const tbody = table.find('tbody#subjetInfo'); // Note: typo in original HTML - "subjet" not "subject"
      
      if (tbody.length > 0) {
        tbody.find('tr').each((i, row) => {
          const tds = $(row).find('td');
          if (tds.length >= 4) {
            const subjectCode = $(tds[0]).text().trim();
            const subjectName = $(tds[1]).text().trim();
            // Column 2: Total Classes in format "58/76" (attended/total)
            const totalClassesText = $(tds[2]).text().trim();
            // Parse "58/76" format
            const classesMatch = totalClassesText.match(/(\d+)\s*\/\s*(\d+)/);
            const attendedClasses = classesMatch ? parseInt(classesMatch[1]) : 0;
            const totalClasses = classesMatch ? parseInt(classesMatch[2]) : 0;
            
            // Compute precise percentage from counts
            const percentage = totalClasses > 0 ? (attendedClasses / totalClasses) * 100 : 0;
            
            if (subjectCode && subjectName) {
              attendanceData.push({
                subjectCode,
                subjectName,
                attendedClasses,
                totalClasses,
                percentage
              });
            }
          }
        });
      }
      
      // Get existing cached data for comparison
      const existingAttendance = await Attendance.find({
        userId: req.user._id,
        semester: targetSemesterNumber || parseInt(targetSemesterId, 10)
      });
      
      const oldData = existingAttendance.map(att => ({
        subjectCode: att.subjectCode,
        attendedClasses: att.attendedClasses,
        totalClasses: att.totalClasses,
        percentage: att.percentage
      }));
      
      // Only update if data differs
      const dataChanged = !attendanceDataEqual(oldData, attendanceData);
      
      // Save to database only if data changed
      const savedAttendance = [];
      if (dataChanged) {
        for (const att of attendanceData) {
          const attendance = await Attendance.findOneAndUpdate(
            {
              userId: req.user._id,
              semester: targetSemesterNumber || parseInt(targetSemesterId, 10),
              subjectCode: att.subjectCode
            },
            {
              subjectName: att.subjectName,
              totalClasses: att.totalClasses,
              attendedClasses: att.attendedClasses,
              percentage: att.percentage
            },
            { upsert: true, new: true }
          );
          savedAttendance.push(attendance);
        }
      } else {
        // Return existing data if unchanged
        savedAttendance.push(...existingAttendance);
      }
      
      // Calculate overall stats
      let totalClasses = 0;
      let totalAttended = 0;
      savedAttendance.forEach(att => {
        totalClasses += att.totalClasses;
        totalAttended += att.attendedClasses;
      });
      
      const overallPercentage = totalClasses > 0 
        ? Math.round((totalAttended / totalClasses) * 100) 
        : 0;
      
      res.json({
        message: 'Attendance synced successfully',
        attendance: savedAttendance,
        overall: {
          totalClasses,
          totalAttended,
          percentage: overallPercentage
        }
      });
    } catch (loginError) {
      if (loginError.message.includes('session expired') || loginError.message.includes('Login failed')) {
        return res.status(401).json({ error: 'PESU Academy login failed. Your credentials may have changed. Please login again.' });
      }
      throw loginError;
    }
  } catch (error) {
    console.error('Error syncing attendance:', error);
    res.status(500).json({ error: error.message || 'Failed to sync attendance' });
  }
});

module.exports = router;

