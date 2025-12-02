const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const cheerio = require('cheerio');

const router = express.Router();

// Register - also uses PESU Academy credentials
router.post('/register', async (req, res) => {
  try {
    const { pesuUsername, pesuPassword } = req.body;
    
    if (!pesuUsername || !pesuPassword) {
      return res.status(400).json({ error: 'PESU Academy username and password required' });
    }

    // Verify credentials by attempting to login to PESU Academy
    const pesuScraper = require('../services/pesuScraper');
    let session;
    try {
      session = await pesuScraper.login(pesuUsername, pesuPassword);
    } catch (loginError) {
      if (loginError.message.includes('invalid credentials') || loginError.message.includes('Login failed')) {
        return res.status(401).json({ error: 'Invalid PESU Academy credentials. Please check your username and password.' });
      }
      throw loginError;
    }

    // Extract SRN from username
    let srn = pesuUsername.toUpperCase();
    if (!srn.match(/^PES[12]/)) {
      srn = pesuUsername.toUpperCase();
    }

    const srnUpper = srn.trim();
    const existingUser = await User.findOne({ srn: srnUpper });
    if (existingUser) {
      return res.status(400).json({ error: 'User already registered. Please login instead.' });
    }

    // Extract user name from profile page
    let userName = '';
    try {
      const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
      const $profile = require('cheerio').load(profileResp.data);
      const nameSpan = $profile('span.app-name-font');
      if (nameSpan.length > 0) {
        userName = nameSpan.first().text().trim();
      }
    } catch (err) {
      // Silently fail - name extraction is optional
    }

    // Create new user with PESU Academy credentials
    const user = new User({ 
      srn: srnUpper, 
      password: pesuPassword, // Use PESU password as user password
      pesuUsername: pesuUsername,
      pesuPassword: pesuPassword,
      name: userName // Store extracted name
    });
    try {
      await user.save();
    } catch (saveError) {
      if (saveError.code === 11000 && saveError.keyPattern?.email) {
        return res.status(500).json({ 
          error: 'Database index error. Please contact administrator or run: node server/fix-email-index.js' 
        });
      }
      throw saveError;
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    // Set cookie with proper settings for development
    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // false in development (true in production with HTTPS)
      sameSite: 'lax', // 'lax' works better in development than 'strict'
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });

    // Update lastLoginAt timestamp
    user.lastLoginAt = new Date();
    await user.save();

    res.json({
      user: {
        id: user._id,
        srn: user.srn,
        currentSemester: user.currentSemester,
        currentSection: user.currentSection,
        hasPesuCredentials: true
      },
      token
    });

    // Start background data loading (don't await - let it run async)
    setImmediate(async () => {
      try {
        if (!user.pesuUsername || !user.pesuPassword) {
          return; // Can't refresh without credentials
        }

        const pesuScraper = require('../services/pesuScraper');
        const cheerio = require('cheerio');
        const Timetable = require('../models/Timetable');
        const Attendance = require('../models/Attendance');
        const Result = require('../models/Result');

        // Create session once and reuse
        const session = await pesuScraper.login(user.pesuUsername, user.pesuPassword);
        const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
        const $profile = cheerio.load(profileResp.data);

        // Helper function to extract menu info
        const extractMenuInfo = ($, keyword) => {
          let menuId = null;
          let controllerMode = null;
          const menuUl = $('#studentProfilePESUHomeMenu');
          if (menuUl.length > 0) {
            menuUl.find('li').each((i, elem) => {
              const menuName = $(elem).find('.menu-name').text().trim();
              if (menuName && menuName.toLowerCase().includes(keyword.toLowerCase())) {
                const idAttr = $(elem).attr('id') || '';
                const menuMatch = idAttr.match(/menuTab_(\d+)/);
                if (menuMatch) menuId = menuMatch[1];
                const dataUrl = $(elem).attr('data-url') || '';
                const parts = dataUrl.split('/');
                if (parts.length >= 3) {
                  const possibleController = parts[parts.length - 2];
                  if (possibleController && /^\d+$/.test(possibleController)) {
                    controllerMode = possibleController;
                  }
                }
              }
            });
          }
          return { menuId, controllerMode };
        };

        // Helper to parse semesters
        const parseSemesters = (html) => {
          const semesters = [];
          const seen = new Set();
          const $ = cheerio.load(html);
          $('option').each((i, elem) => {
            const value = $(elem).attr('value');
            if (!value) return;
            const cleanValue = value.replace(/['"]/g, '').trim();
            if (!cleanValue || seen.has(cleanValue)) return;
            seen.add(cleanValue);
            const label = $(elem).text().trim();
            const semMatch = label.match(/Sem[-\s]*(\d+)/i);
            const semNumber = semMatch ? parseInt(semMatch[1], 10) : null;
            semesters.push({ semId: cleanValue, semNumber, label });
          });
          return semesters;
        };

        // 1. Refresh semesters
        try {
          const response = await session.get('https://www.pesuacademy.com/Academy/a/studentProfilePESU/getStudentSemestersPESU', {
            headers: { 'Referer': 'https://www.pesuacademy.com/Academy/s/studentProfilePESU' },
          });
          const parsedSemesters = parseSemesters(response.data);
          if (parsedSemesters.length > 0) {
            user.semesterCache = parsedSemesters;
            user.semesterCacheUpdatedAt = new Date();
            await user.save();
          }
        } catch (err) {}

        // 2. Refresh timetable
        try {
          let { menuId, controllerMode } = extractMenuInfo($profile, 'time table');
          if (!menuId) menuId = '669';
          if (!controllerMode) controllerMode = '6415';

          const html = await pesuScraper.getTimetableHtml(session, menuId, controllerMode);
          const timetableRoute = require('../routes/timetable');
          const timetable = timetableRoute.parseTimetable ? timetableRoute.parseTimetable(html) : [];

          if (timetable.length > 0) {
            await Timetable.findOneAndUpdate(
              { userId: user._id },
              { userId: user._id, timetable, updatedAt: new Date() },
              { upsert: true, new: true }
            );
          }
        } catch (err) {}

        // 3. Refresh attendance for all available semesters
        if (user.semesterCache && user.semesterCache.length > 0) {
          try {
            const { menuId, controllerMode } = extractMenuInfo($profile, 'attendance');
            if (menuId && controllerMode) {
              // Cache attendance for all semesters
              const attendancePromises = user.semesterCache.map(async (semData) => {
                if (!semData.semId || !semData.semNumber) return;
                
                try {
                  const html = await pesuScraper.getAttendanceHtml(session, semData.semId, menuId, controllerMode);
                  const $ = cheerio.load(html);
                  const tbody = $('tbody#subjetInfo');
                  
                  if (tbody.length > 0) {
                    const updates = [];
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
                          updates.push(
                            Attendance.findOneAndUpdate(
                              { userId: user._id, semester: semData.semNumber, subjectCode },
                              { subjectName, attendedClasses, totalClasses, percentage },
                              { upsert: true, new: true }
                            )
                          );
                        }
                      }
                    });
                    return Promise.all(updates);
                  }
                } catch (err) {
                  // Silently fail individual semester attendance fetch
                }
              });
              
              await Promise.all(attendancePromises);
            }
          } catch (err) {
            // Silently fail - attendance refresh failed
          }
        }

        // 4. Cache subjects for all semesters
        if (user.semesterCache && user.semesterCache.length > 0) {
          try {
            const { menuId, controllerMode } = extractMenuInfo($profile, 'courses');
            if (menuId && controllerMode) {
              const csrfToken = $profile('meta[name="csrf-token"]').attr('content');
              const BASE_URL = 'https://www.pesuacademy.com';
              const ADMIN_URL = `${BASE_URL}/Academy/s/studentProfilePESUAdmin`;
              
              const subjectsPromises = user.semesterCache.map(async (semData) => {
                if (!semData.semId || !semData.semNumber) return;
                
                try {
                  const cleanSemesterId = String(semData.semId).replace(/\D/g, '');
                  const formData = {
                    controllerMode: '6403',
                    actionType: '38',
                    id: cleanSemesterId,
                    menuId: menuId,
                    ...(csrfToken && { _csrf: csrfToken })
                  };
                  
                  const response = await session.post(ADMIN_URL, formData, {
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      'X-Requested-With': 'XMLHttpRequest',
                      'Referer': `${BASE_URL}/Academy/s/studentProfilePESU`,
                      ...(csrfToken && { 'X-CSRF-Token': csrfToken })
                    }
                  });
                  
                  const $ = cheerio.load(response.data);
                  const container = $('#getStudentSubjectsBasedOnSemesters');
                  const searchContainer = container.length > 0 ? container : $('body');
                  const table = searchContainer.find('table').first();
                  
                  if (table.length === 0) return;
                  
                  const headers = [];
                  table.find('th').each((i, th) => {
                    headers.push($(th).text().trim());
                  });
                  
                  const subjects = [];
                  const onclickRe = /(clickoncoursecontent|clickOnCourseContent)\s*\(\s*'?\s*(\d+)\s*'?/i;
                  
                  table.find('tr').each((i, tr) => {
                    const tds = $(tr).find('td');
                    if (tds.length === 0) return;
                    
                    const cells = [];
                    tds.each((j, td) => {
                      cells.push($(td).text().trim());
                    });
                    
                    let courseId = null;
                    const $tr = $(tr);
                    let match = null;
                    
                    const trOnclick = $tr.attr('onclick');
                    if (trOnclick) {
                      match = onclickRe.exec(trOnclick);
                    }
                    
                    if (!match) {
                      const firstTd = $tr.find('td').first();
                      const firstTdOnclick = firstTd.attr('onclick');
                      if (firstTdOnclick) {
                        match = onclickRe.exec(firstTdOnclick);
                      }
                      
                      if (!match) {
                        firstTd.find('a').each((j, a) => {
                          const aOnclick = $(a).attr('onclick');
                          if (aOnclick) {
                            match = onclickRe.exec(aOnclick);
                            if (match) return false;
                          }
                        });
                      }
                    }
                    
                    if (!match) {
                      const rowHtml = '<tr' + 
                        ($tr.attr('class') ? ' class="' + $tr.attr('class') + '"' : '') +
                        ($tr.attr('id') ? ' id="' + $tr.attr('id') + '"' : '') +
                        '>' + $tr.html() + '</tr>';
                      match = onclickRe.exec(rowHtml);
                    }
                    
                    if (match) {
                      courseId = match[2];
                    }
                    
                    subjects.push({
                      cells,
                      courseId,
                      code: cells[0] || '',
                      name: cells[1] || ''
                    });
                  });
                  
                  if (subjects.length > 0) {
                    if (!user.subjectsCache) {
                      user.subjectsCache = [];
                    }
                    
                    const cacheIndex = user.subjectsCache.findIndex(
                      cache => cache.semesterId === cleanSemesterId
                    );
                    
                    const cacheEntry = {
                      semesterId: cleanSemesterId,
                      semesterNumber: semData.semNumber,
                      subjects: subjects,
                      headers: headers,
                      updatedAt: new Date()
                    };
                    
                    if (cacheIndex >= 0) {
                      user.subjectsCache[cacheIndex] = cacheEntry;
                    } else {
                      user.subjectsCache.push(cacheEntry);
                    }
                  }
                } catch (err) {
                  // Silently fail individual semester subjects fetch
                }
              });
              
              await Promise.all(subjectsPromises);
              await user.save();
            }
          } catch (err) {
            // Silently fail - subjects cache refresh failed
          }
        }

        // 5. Refresh results for current semester (only if not cached in last 7 days)
        if (user.semesterCache && user.semesterCache.length > 0) {
          try {
            const currentSem = user.currentSemester || 3;
            const currentSemData = user.semesterCache.find(s => s.semNumber === currentSem);
            if (currentSemData && currentSemData.semId) {
              // Check if results are already cached within last 7 days
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
              
              const cachedResults = await Result.find({
                userId: user._id,
                semester: currentSem,
                updatedAt: { $gte: sevenDaysAgo }
              });
              
              // Only fetch from PESU if no recent cache exists
              if (cachedResults.length === 0) {
                const { menuId, controllerMode } = extractMenuInfo($profile, 'results');
                if (menuId && controllerMode) {
                  const html = await pesuScraper.getResultsHtml(session, currentSemData.semId, menuId, controllerMode);
                  const resultsRoute = require('../routes/results');
                  const parsedResults = resultsRoute.parseResultsHtml ? resultsRoute.parseResultsHtml(html) : [];
                  
                  const updates = parsedResults.map(entry =>
                    Result.findOneAndUpdate(
                      { userId: user._id, semester: currentSem, subjectCode: entry.subjectCode },
                      {
                        subjectName: entry.subjectName,
                        ia1: entry.ia1,
                        ia2: entry.ia2,
                        ese: entry.ese,
                        total: entry.total,
                        maxMarks: entry.maxMarks
                      },
                      { upsert: true, new: true }
                    )
                  );
                  await Promise.all(updates);
                }
              }
            }
          } catch (err) {}
        }
      } catch (error) {
        // Silently fail - overall refresh failed
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

// Login - verifies PESU Academy credentials and creates/updates user
router.post('/login', async (req, res) => {
  try {
    const { pesuUsername, pesuPassword, rememberPassword } = req.body;
    
    if (!pesuUsername || !pesuPassword) {
      return res.status(400).json({ error: 'PESU Academy username and password required' });
    }

    // Verify credentials by attempting to login to PESU Academy
    const pesuScraper = require('../services/pesuScraper');
    let session;
    try {
      session = await pesuScraper.login(pesuUsername, pesuPassword);
    } catch (loginError) {
      if (loginError.message.includes('invalid credentials') || loginError.message.includes('Login failed')) {
        return res.status(401).json({ error: 'Invalid PESU Academy credentials. Please check your username and password.' });
      }
      throw loginError;
    }

    // If login successful, get user info from PESU Academy
    // Extract SRN from username - use the username as-is (it should be the SRN)
    // Normalize: uppercase and trim
    const srn = pesuUsername.toUpperCase().trim();

    // Extract user's name from profile page
    let userName = '';
    try {
      const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
      const $profile = cheerio.load(profileResp.data);
      const nameSpan = $profile('span.app-name-font');
      if (nameSpan.length > 0) {
        userName = nameSpan.first().text().trim();
      }
    } catch (err) {
      // Silently fail - name extraction is optional
    }

    // Find or create user
    let user = await User.findOne({ srn: srn });
    
    if (!user) {
      // Create new user with PESU Academy credentials
      user = new User({
        srn: srn,
        password: pesuPassword, // Store PESU password as the user password
        pesuUsername: pesuUsername.trim(), // Store original username (case-sensitive)
        pesuPassword: pesuPassword,
        name: userName // Store extracted name
      });
      try {
        await user.save();
      } catch (saveError) {
        if (saveError.code === 11000 && saveError.keyPattern?.email) {
          return res.status(500).json({ 
            error: 'Database index error. Please contact administrator or run: node server/fix-email-index.js' 
          });
        }
        throw saveError;
      }
    } else {
      // Update existing user's PESU credentials (in case they changed)
      user.pesuUsername = pesuUsername.trim();
      user.pesuPassword = pesuPassword;
      if (userName) {
        user.name = userName; // Update name if extracted
      }
      if (rememberPassword) {
        user.rememberPassword = true;
      }
      try {
        await user.save();
      } catch (saveError) {
        if (saveError.code === 11000 && saveError.keyPattern?.email) {
          return res.status(500).json({ 
            error: 'Database index error. Please contact administrator or run: node server/fix-email-index.js' 
          });
        }
        throw saveError;
      }
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    // Set cookie with proper settings for development
    res.cookie('token', token, {
      httpOnly: true,
      secure: false, // false in development (true in production with HTTPS)
      sameSite: 'lax', // 'lax' works better in development than 'strict'
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });

    // Update lastLoginAt timestamp
    user.lastLoginAt = new Date();
    await user.save();

    res.json({
      user: {
        id: user._id,
        srn: user.srn,
        name: user.name || userName,
        currentSemester: user.currentSemester,
        currentSection: user.currentSection,
        hasPesuCredentials: true
      },
      token
    });

    // Start background data loading (don't await - let it run async)
    setImmediate(async () => {
      try {
        if (!user.pesuUsername || !user.pesuPassword) {
          return; // Can't refresh without credentials
        }

        const pesuScraper = require('../services/pesuScraper');
        const cheerio = require('cheerio');
        const Timetable = require('../models/Timetable');
        const Attendance = require('../models/Attendance');
        const Result = require('../models/Result');

        // Create session once and reuse
        const session = await pesuScraper.login(user.pesuUsername, user.pesuPassword);
        const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
        const $profile = cheerio.load(profileResp.data);

        // Helper function to extract menu info
        const extractMenuInfo = ($, keyword) => {
          let menuId = null;
          let controllerMode = null;
          const menuUl = $('#studentProfilePESUHomeMenu');
          if (menuUl.length > 0) {
            menuUl.find('li').each((i, elem) => {
              const menuName = $(elem).find('.menu-name').text().trim();
              if (menuName && menuName.toLowerCase().includes(keyword.toLowerCase())) {
                const idAttr = $(elem).attr('id') || '';
                const menuMatch = idAttr.match(/menuTab_(\d+)/);
                if (menuMatch) menuId = menuMatch[1];
                const dataUrl = $(elem).attr('data-url') || '';
                const parts = dataUrl.split('/');
                if (parts.length >= 3) {
                  const possibleController = parts[parts.length - 2];
                  if (possibleController && /^\d+$/.test(possibleController)) {
                    controllerMode = possibleController;
                  }
                }
              }
            });
          }
          return { menuId, controllerMode };
        };

        // Helper to parse semesters
        const parseSemesters = (html) => {
          const semesters = [];
          const seen = new Set();
          const $ = cheerio.load(html);
          $('option').each((i, elem) => {
            const value = $(elem).attr('value');
            if (!value) return;
            const cleanValue = value.replace(/['"]/g, '').trim();
            if (!cleanValue || seen.has(cleanValue)) return;
            seen.add(cleanValue);
            const label = $(elem).text().trim();
            const semMatch = label.match(/Sem[-\s]*(\d+)/i);
            const semNumber = semMatch ? parseInt(semMatch[1], 10) : null;
            semesters.push({ semId: cleanValue, semNumber, label });
          });
          return semesters;
        };

        // 1. Refresh semesters
        try {
          const response = await session.get('https://www.pesuacademy.com/Academy/a/studentProfilePESU/getStudentSemestersPESU', {
            headers: { 'Referer': 'https://www.pesuacademy.com/Academy/s/studentProfilePESU' },
          });
          const parsedSemesters = parseSemesters(response.data);
          if (parsedSemesters.length > 0) {
            user.semesterCache = parsedSemesters;
            user.semesterCacheUpdatedAt = new Date();
            await user.save();
          }
        } catch (err) {}

        // 2. Refresh timetable
        try {
          let { menuId, controllerMode } = extractMenuInfo($profile, 'time table');
          if (!menuId) menuId = '669';
          if (!controllerMode) controllerMode = '6415';

          const html = await pesuScraper.getTimetableHtml(session, menuId, controllerMode);
          const timetableRoute = require('../routes/timetable');
          const timetable = timetableRoute.parseTimetable ? timetableRoute.parseTimetable(html) : [];

          if (timetable.length > 0) {
            await Timetable.findOneAndUpdate(
              { userId: user._id },
              { userId: user._id, timetable, updatedAt: new Date() },
              { upsert: true, new: true }
            );
          }
        } catch (err) {}

        // 3. Refresh attendance for all available semesters
        if (user.semesterCache && user.semesterCache.length > 0) {
          try {
            const { menuId, controllerMode } = extractMenuInfo($profile, 'attendance');
            if (menuId && controllerMode) {
              // Cache attendance for all semesters
              const attendancePromises = user.semesterCache.map(async (semData) => {
                if (!semData.semId || !semData.semNumber) return;
                
                try {
                  const html = await pesuScraper.getAttendanceHtml(session, semData.semId, menuId, controllerMode);
                  const $ = cheerio.load(html);
                  const tbody = $('tbody#subjetInfo');
                  
                  if (tbody.length > 0) {
                    const updates = [];
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
                          updates.push(
                            Attendance.findOneAndUpdate(
                              { userId: user._id, semester: semData.semNumber, subjectCode },
                              { subjectName, attendedClasses, totalClasses, percentage },
                              { upsert: true, new: true }
                            )
                          );
                        }
                      }
                    });
                    return Promise.all(updates);
                  }
                } catch (err) {
                  // Silently fail individual semester attendance fetch
                }
              });
              
              await Promise.all(attendancePromises);
            }
          } catch (err) {
            // Silently fail - attendance refresh failed
          }
        }

        // 4. Cache subjects for all semesters
        if (user.semesterCache && user.semesterCache.length > 0) {
          try {
            const { menuId, controllerMode } = extractMenuInfo($profile, 'courses');
            if (menuId && controllerMode) {
              const csrfToken = $profile('meta[name="csrf-token"]').attr('content');
              const BASE_URL = 'https://www.pesuacademy.com';
              const ADMIN_URL = `${BASE_URL}/Academy/s/studentProfilePESUAdmin`;
              
              const subjectsPromises = user.semesterCache.map(async (semData) => {
                if (!semData.semId || !semData.semNumber) return;
                
                try {
                  const cleanSemesterId = String(semData.semId).replace(/\D/g, '');
                  const formData = {
                    controllerMode: '6403',
                    actionType: '38',
                    id: cleanSemesterId,
                    menuId: menuId,
                    ...(csrfToken && { _csrf: csrfToken })
                  };
                  
                  const response = await session.post(ADMIN_URL, formData, {
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                      'X-Requested-With': 'XMLHttpRequest',
                      'Referer': `${BASE_URL}/Academy/s/studentProfilePESU`,
                      ...(csrfToken && { 'X-CSRF-Token': csrfToken })
                    }
                  });
                  
                  const $ = cheerio.load(response.data);
                  const container = $('#getStudentSubjectsBasedOnSemesters');
                  const searchContainer = container.length > 0 ? container : $('body');
                  const table = searchContainer.find('table').first();
                  
                  if (table.length === 0) return;
                  
                  const headers = [];
                  table.find('th').each((i, th) => {
                    headers.push($(th).text().trim());
                  });
                  
                  const subjects = [];
                  const onclickRe = /(clickoncoursecontent|clickOnCourseContent)\s*\(\s*'?\s*(\d+)\s*'?/i;
                  
                  table.find('tr').each((i, tr) => {
                    const tds = $(tr).find('td');
                    if (tds.length === 0) return;
                    
                    const cells = [];
                    tds.each((j, td) => {
                      cells.push($(td).text().trim());
                    });
                    
                    let courseId = null;
                    const $tr = $(tr);
                    let match = null;
                    
                    const trOnclick = $tr.attr('onclick');
                    if (trOnclick) {
                      match = onclickRe.exec(trOnclick);
                    }
                    
                    if (!match) {
                      const firstTd = $tr.find('td').first();
                      const firstTdOnclick = firstTd.attr('onclick');
                      if (firstTdOnclick) {
                        match = onclickRe.exec(firstTdOnclick);
                      }
                      
                      if (!match) {
                        firstTd.find('a').each((j, a) => {
                          const aOnclick = $(a).attr('onclick');
                          if (aOnclick) {
                            match = onclickRe.exec(aOnclick);
                            if (match) return false;
                          }
                        });
                      }
                    }
                    
                    if (!match) {
                      const rowHtml = '<tr' + 
                        ($tr.attr('class') ? ' class="' + $tr.attr('class') + '"' : '') +
                        ($tr.attr('id') ? ' id="' + $tr.attr('id') + '"' : '') +
                        '>' + $tr.html() + '</tr>';
                      match = onclickRe.exec(rowHtml);
                    }
                    
                    if (match) {
                      courseId = match[2];
                    }
                    
                    subjects.push({
                      cells,
                      courseId,
                      code: cells[0] || '',
                      name: cells[1] || ''
                    });
                  });
                  
                  if (subjects.length > 0) {
                    if (!user.subjectsCache) {
                      user.subjectsCache = [];
                    }
                    
                    const cacheIndex = user.subjectsCache.findIndex(
                      cache => cache.semesterId === cleanSemesterId
                    );
                    
                    const cacheEntry = {
                      semesterId: cleanSemesterId,
                      semesterNumber: semData.semNumber,
                      subjects: subjects,
                      headers: headers,
                      updatedAt: new Date()
                    };
                    
                    if (cacheIndex >= 0) {
                      user.subjectsCache[cacheIndex] = cacheEntry;
                    } else {
                      user.subjectsCache.push(cacheEntry);
                    }
                  }
                } catch (err) {
                  // Silently fail individual semester subjects fetch
                }
              });
              
              await Promise.all(subjectsPromises);
              await user.save();
            }
          } catch (err) {
            // Silently fail - subjects cache refresh failed
          }
        }

        // 5. Refresh results for current semester (only if not cached in last 7 days)
        if (user.semesterCache && user.semesterCache.length > 0) {
          try {
            const currentSem = user.currentSemester || 3;
            const currentSemData = user.semesterCache.find(s => s.semNumber === currentSem);
            if (currentSemData && currentSemData.semId) {
              // Check if results are already cached within last 7 days
              const sevenDaysAgo = new Date();
              sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
              
              const cachedResults = await Result.find({
                userId: user._id,
                semester: currentSem,
                updatedAt: { $gte: sevenDaysAgo }
              });
              
              // Only fetch from PESU if no recent cache exists
              if (cachedResults.length === 0) {
                const { menuId, controllerMode } = extractMenuInfo($profile, 'results');
                if (menuId && controllerMode) {
                  const html = await pesuScraper.getResultsHtml(session, currentSemData.semId, menuId, controllerMode);
                  const resultsRoute = require('../routes/results');
                  const parsedResults = resultsRoute.parseResultsHtml ? resultsRoute.parseResultsHtml(html) : [];
                  
                  const updates = parsedResults.map(entry =>
                    Result.findOneAndUpdate(
                      { userId: user._id, semester: currentSem, subjectCode: entry.subjectCode },
                      {
                        subjectName: entry.subjectName,
                        ia1: entry.ia1,
                        ia2: entry.ia2,
                        ese: entry.ese,
                        total: entry.total,
                        maxMarks: entry.maxMarks
                      },
                      { upsert: true, new: true }
                    )
                  );
                  await Promise.all(updates);
                }
              }
            }
          } catch (err) {}
        }
      } catch (error) {
        // Silently fail - overall refresh failed
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        srn: req.user.srn,
        name: req.user.name || '',
        currentSemester: req.user.currentSemester,
        currentSection: req.user.currentSection,
        hasPesuCredentials: !!(req.user.pesuUsername && req.user.pesuPassword)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// Update PESU credentials
router.post('/pesu-credentials', auth, async (req, res) => {
  try {
    const { pesuUsername, pesuPassword } = req.body;
    
    if (!pesuUsername || !pesuPassword) {
      return res.status(400).json({ error: 'Both username and password are required' });
    }
    
    // Optionally validate credentials by trying to login
    // But for now, just save them
    req.user.pesuUsername = pesuUsername;
    req.user.pesuPassword = pesuPassword;
    await req.user.save();
    
    res.json({ 
      message: 'PESU credentials saved successfully',
      hasPesuCredentials: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update semester/section
router.post('/settings', auth, async (req, res) => {
  try {
    const { currentSemester, currentSection } = req.body;
    if (currentSemester) req.user.currentSemester = currentSemester;
    if (currentSection) req.user.currentSection = currentSection;
    await req.user.save();
    res.json({
      user: {
        id: req.user._id,
        srn: req.user.srn,
        currentSemester: req.user.currentSemester,
        currentSection: req.user.currentSection
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Background refresh - caches all data (semesters, timetable, attendance, results)
router.post('/refresh', auth, async (req, res) => {
  // Return immediately - refresh happens in background
  res.json({ message: 'Background refresh started' });

  // Start background refresh (don't await - let it run async)
  setImmediate(async () => {
    try {
      if (!req.user.pesuUsername || !req.user.pesuPassword) {
        return; // Can't refresh without credentials
      }

      const pesuScraper = require('../services/pesuScraper');
      const cheerio = require('cheerio');
      const Timetable = require('../models/Timetable');
      const Attendance = require('../models/Attendance');
      const Result = require('../models/Result');

      // Create session once and reuse
      const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
      const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
      const $profile = cheerio.load(profileResp.data);

      // Update user's name if available
      try {
        const nameSpan = $profile('span.app-name-font');
        if (nameSpan.length > 0) {
          const userName = nameSpan.first().text().trim();
          if (userName && userName !== req.user.name) {
            req.user.name = userName;
            await req.user.save();
          }
        }
      } catch (err) {
        // Silently fail - name update is optional
      }

      // Helper function to extract menu info
      const extractMenuInfo = ($, keyword) => {
        let menuId = null;
        let controllerMode = null;
        const menuUl = $('#studentProfilePESUHomeMenu');
        if (menuUl.length > 0) {
          menuUl.find('li').each((i, elem) => {
            const menuName = $(elem).find('.menu-name').text().trim();
            if (menuName && menuName.toLowerCase().includes(keyword.toLowerCase())) {
              const idAttr = $(elem).attr('id') || '';
              const menuMatch = idAttr.match(/menuTab_(\d+)/);
              if (menuMatch) menuId = menuMatch[1];
              const dataUrl = $(elem).attr('data-url') || '';
              const parts = dataUrl.split('/');
              if (parts.length >= 3) {
                const possibleController = parts[parts.length - 2];
                if (possibleController && /^\d+$/.test(possibleController)) {
                  controllerMode = possibleController;
                }
              }
            }
          });
        }
        return { menuId, controllerMode };
      };

      // Helper to parse semesters
      const parseSemesters = (html) => {
        const semesters = [];
        const seen = new Set();
        const $ = cheerio.load(html);
        $('option').each((i, elem) => {
          const value = $(elem).attr('value');
          if (!value) return;
          const cleanValue = value.replace(/['"]/g, '').trim();
          if (!cleanValue || seen.has(cleanValue)) return;
          seen.add(cleanValue);
          const label = $(elem).text().trim();
          const semMatch = label.match(/Sem[-\s]*(\d+)/i);
          const semNumber = semMatch ? parseInt(semMatch[1], 10) : null;
          semesters.push({ semId: cleanValue, semNumber, label });
        });
        return semesters;
      };

      // 1. Refresh semesters
      try {
        const response = await session.get('https://www.pesuacademy.com/Academy/a/studentProfilePESU/getStudentSemestersPESU', {
          headers: { 'Referer': 'https://www.pesuacademy.com/Academy/s/studentProfilePESU' },
        });
        const parsedSemesters = parseSemesters(response.data);
        if (parsedSemesters.length > 0) {
          req.user.semesterCache = parsedSemesters;
          req.user.semesterCacheUpdatedAt = new Date();
          await req.user.save();
        }
      } catch (err) {}

      // 2. Refresh timetable
      try {
        let { menuId, controllerMode } = extractMenuInfo($profile, 'time table');
        if (!menuId) menuId = '669';
        if (!controllerMode) controllerMode = '6415';

        const html = await pesuScraper.getTimetableHtml(session, menuId, controllerMode);
        const timetableRoute = require('../routes/timetable');
        const timetable = timetableRoute.parseTimetable ? timetableRoute.parseTimetable(html) : [];

        if (timetable.length > 0) {
          await Timetable.findOneAndUpdate(
            { userId: req.user._id },
            { userId: req.user._id, timetable, updatedAt: new Date() },
            { upsert: true, new: true }
          );
        }
      } catch (err) {}

      // 3. Refresh attendance for all available semesters
      if (req.user.semesterCache && req.user.semesterCache.length > 0) {
        try {
          const { menuId, controllerMode } = extractMenuInfo($profile, 'attendance');
          if (menuId && controllerMode) {
            // Cache attendance for all semesters
            const attendancePromises = req.user.semesterCache.map(async (semData) => {
              if (!semData.semId || !semData.semNumber) return;
              
              try {
                const html = await pesuScraper.getAttendanceHtml(session, semData.semId, menuId, controllerMode);
                const $ = cheerio.load(html);
                const tbody = $('tbody#subjetInfo');
                
                if (tbody.length > 0) {
                  const updates = [];
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
                        updates.push(
                          Attendance.findOneAndUpdate(
                            { userId: req.user._id, semester: semData.semNumber, subjectCode },
                            { subjectName, attendedClasses, totalClasses, percentage },
                            { upsert: true, new: true }
                          )
                        );
                      }
                    }
                  });
                  return Promise.all(updates);
                }
              } catch (err) {
                // Silently fail individual semester attendance fetch
              }
            });
            
            await Promise.all(attendancePromises);
          }
        } catch (err) {
          // Silently fail - attendance refresh failed
        }
      }

      // 4. Refresh results for current semester (only if not cached in last 7 days)
      if (req.user.semesterCache && req.user.semesterCache.length > 0) {
        try {
          const currentSem = req.user.currentSemester || 3;
          const currentSemData = req.user.semesterCache.find(s => s.semNumber === currentSem);
          if (currentSemData && currentSemData.semId) {
            // Check if results are already cached within last 7 days
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            
            const cachedResults = await Result.find({
              userId: req.user._id,
              semester: currentSem,
              updatedAt: { $gte: sevenDaysAgo }
            });
            
            // Only fetch from PESU if no recent cache exists
            if (cachedResults.length === 0) {
              const { menuId, controllerMode } = extractMenuInfo($profile, 'results');
              if (menuId && controllerMode) {
                const html = await pesuScraper.getResultsHtml(session, currentSemData.semId, menuId, controllerMode);
                const resultsRoute = require('../routes/results');
                const parsedResults = resultsRoute.parseResultsHtml ? resultsRoute.parseResultsHtml(html) : [];
                
                const updates = parsedResults.map(entry =>
                  Result.findOneAndUpdate(
                    { userId: req.user._id, semester: currentSem, subjectCode: entry.subjectCode },
                    {
                      subjectName: entry.subjectName,
                      ia1: entry.ia1,
                      ia2: entry.ia2,
                      ese: entry.ese,
                      total: entry.total,
                      maxMarks: entry.maxMarks
                    },
                    { upsert: true, new: true }
                  )
                );
                await Promise.all(updates);
              }
            }
          }
        } catch (err) {}
      }
    } catch (error) {
      // Silently fail - overall refresh failed
    }
  });
});

module.exports = router;

