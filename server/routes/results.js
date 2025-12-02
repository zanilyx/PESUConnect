const express = require('express');
const Result = require('../models/Result');
const auth = require('../middleware/auth');
const pesuScraper = require('../services/pesuScraper');
const cheerio = require('cheerio');

const router = express.Router();

function extractMenuInfo($, menuNameKeyword) {
  let menuId = null;
  let controllerMode = null;

  const menuUl = $('#studentProfilePESUHomeMenu');
  if (menuUl.length > 0) {
    menuUl.find('li').each((i, elem) => {
      const menuName = $(elem).find('.menu-name').text().trim();
      if (menuName && menuName.toLowerCase().includes(menuNameKeyword.toLowerCase())) {
        const idAttr = $(elem).attr('id') || '';
        const menuIdMatch = idAttr.match(/menuTab_(\d+)/);
        if (menuIdMatch) {
          menuId = menuIdMatch[1];
        }

        const dataUrl = $(elem).attr('data-url') || '';
        const urlParts = dataUrl.split('/');
        if (urlParts.length >= 3) {
          const possibleControllerMode = urlParts[urlParts.length - 2];
          if (possibleControllerMode && /^\d+$/.test(possibleControllerMode)) {
            controllerMode = possibleControllerMode;
          }
        }
      }
    });
  }

  return { menuId, controllerMode };
}

function parseScore(text) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/([0-9.]+)\s*\/\s*([0-9.]+)/);
  if (match) {
    return {
      scored: parseFloat(match[1]) || 0,
      total: parseFloat(match[2]) || 0,
      raw: normalized
    };
  }
  const singleMatch = normalized.match(/([0-9.]+)/);
  return {
    scored: singleMatch ? parseFloat(singleMatch[1]) : 0,
    total: 0,
    raw: normalized
  };
}

function parseResultsHtml(html) {
  const $ = cheerio.load(html);
  let container = $('#isaEsaResult_3');
  if (!container || container.length === 0) {
    container = $('[id^="isaEsaResult"]').first();
  }
  let cards = container && container.length ? container.find('div.clearfix') : $('.clearfix');
  const results = [];

  cards.each((_, card) => {
    const $card = $(card);
    const headerText = $card.find('.header-info').text().replace(/\s+/g, ' ').trim();
    let subjectCode = '';
    let subjectName = headerText;

    if (headerText.includes('-')) {
      const [codePart, ...rest] = headerText.split('-');
      subjectCode = codePart.trim();
      subjectName = rest.join('-').trim();
    } else {
      const match = headerText.match(/^([A-Z0-9]+)\s+(.*)$/);
      if (match) {
        subjectCode = match[1].trim();
        subjectName = match[2].trim();
      }
    }

    const statDivs = $card.find('.dashboard-info-bar').find('div');
    const ia1Score = parseScore(statDivs.eq(0).text());
    const finalIsaScore = parseScore(statDivs.eq(1).text());
    const esaScore = parseScore(statDivs.eq(2).text());

    const ia1 = ia1Score.scored || 0;
    const ia2 = finalIsaScore.scored || 0;
    const ese = esaScore.scored || 0;
    const maxMarks = (ia1Score.total || 0) + (finalIsaScore.total || 0) + (esaScore.total || 0);

    results.push({
      subjectCode: subjectCode || `COURSE-${results.length + 1}`,
      subjectName: subjectName || 'Unknown Course',
      ia1,
      ia2,
      ese,
      total: ia1 + ia2 + ese,
      maxMarks: maxMarks || 100
    });
  });

  return results;
}

// Export functions for use in other routes
module.exports.parseResultsHtml = parseResultsHtml;
module.exports.extractMenuInfo = extractMenuInfo;

function calculateGPA(results = []) {
  let totalPoints = 0;
  let totalCredits = 0;

  results.forEach(result => {
    const percentage = result.maxMarks > 0 ? (result.total / result.maxMarks) * 100 : 0;
    let gradePoints = 0;
    if (percentage >= 90) gradePoints = 10;
    else if (percentage >= 80) gradePoints = 9;
    else if (percentage >= 70) gradePoints = 8;
    else if (percentage >= 60) gradePoints = 7;
    else if (percentage >= 50) gradePoints = 6;
    else if (percentage >= 40) gradePoints = 5;
    else gradePoints = 0;

    totalPoints += gradePoints * 3;
    totalCredits += 3;
  });

  const gpa = totalCredits > 0 ? (totalPoints / totalCredits) : 0;
  return parseFloat(gpa.toFixed(2));
}

// Helper function to compare results data
function resultsDataEqual(oldResults, newResults) {
  if (!oldResults || !newResults || oldResults.length !== newResults.length) {
    return false;
  }
  
  const oldMap = new Map();
  oldResults.forEach(result => {
    oldMap.set(result.subjectCode, {
      ia1: result.ia1,
      ia2: result.ia2,
      ese: result.ese,
      total: result.total
    });
  });
  
  for (const newResult of newResults) {
    const oldResult = oldMap.get(newResult.subjectCode);
    if (!oldResult) return false;
    if (oldResult.ia1 !== newResult.ia1 || oldResult.ia2 !== newResult.ia2 || 
        oldResult.ese !== newResult.ese || oldResult.total !== newResult.total) {
      return false;
    }
  }
  
  return true;
}

// Get results for a semester (from DB)
router.get('/:semester', auth, async (req, res) => {
  try {
    const { semester } = req.params;
    const semesterNum = parseInt(semester);
    
    // Return cached results immediately (no checks, just return what's in DB)
    const results = await Result.find({
      userId: req.user._id,
      semester: semesterNum
    });

    // Always fetch in background if credentials exist (regardless of cache age)
    if (req.user.pesuUsername && req.user.pesuPassword) {
      setImmediate(async () => {
        try {
          const User = require('../models/User');
          const user = await User.findById(req.user._id);
          if (!user) return;
          
          const semData = user.semesterCache?.find(s => s.semNumber === semesterNum);
          if (!semData || !semData.semId) return;
          
          const session = await pesuScraper.login(user.pesuUsername, user.pesuPassword);
          const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
          const $profile = cheerio.load(profileResp.data);
          const { menuId, controllerMode } = extractMenuInfo($profile, 'results');
          
          if (menuId && controllerMode) {
            const html = await pesuScraper.getResultsHtml(session, semData.semId, menuId, controllerMode);
            const parsedResults = parseResultsHtml(html);
            
            // Get current results from DB
            const currentResults = await Result.find({
              userId: user._id,
              semester: semesterNum
            });
            
            // Only update if data differs
            if (!resultsDataEqual(currentResults, parsedResults)) {
              const updates = parsedResults.map(entry =>
                Result.findOneAndUpdate(
                  { userId: user._id, semester: semesterNum, subjectCode: entry.subjectCode },
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
        } catch (err) {
          // Silently fail background update
        }
      });
    }

    // Return immediately with cached data
    res.json({
      results,
      currentGPA: calculateGPA(results),
      cached: results.length > 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update result
router.post('/', auth, async (req, res) => {
  try {
    const { semester, subjectCode, subjectName, ia1, ia2, ese, maxMarks } = req.body;
    const total = (ia1 || 0) + (ia2 || 0) + (ese || 0);

    const result = await Result.findOneAndUpdate(
      {
        userId: req.user._id,
        semester,
        subjectCode
      },
      {
        subjectName,
        ia1,
        ia2,
        ese,
        total,
        maxMarks: maxMarks || 100
      },
      { upsert: true, new: true }
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync results from PESU Academy
router.post('/sync', auth, async (req, res) => {
  try {
    const { semesterId, semesterNumber } = req.body;
    if (!semesterId) {
      return res.status(400).json({ error: 'Semester ID is required' });
    }

    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }

    const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
    const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
    const $profile = cheerio.load(profileResp.data);
    const { menuId, controllerMode } = extractMenuInfo($profile, 'results');

    if (!menuId || !controllerMode) {
      return res.status(500).json({ error: 'Could not extract Results menu information from PESU Academy' });
    }

    const html = await pesuScraper.getResultsHtml(session, semesterId, menuId, controllerMode);
    const parsedResults = parseResultsHtml(html);

    const semesterValue = semesterNumber || req.user.currentSemester || 1;
    const savedResults = [];
    for (const entry of parsedResults) {
      const result = await Result.findOneAndUpdate(
        {
          userId: req.user._id,
          semester: semesterValue,
          subjectCode: entry.subjectCode
        },
        {
          subjectName: entry.subjectName,
          ia1: entry.ia1,
          ia2: entry.ia2,
          ese: entry.ese,
          total: entry.total,
          maxMarks: entry.maxMarks
        },
        { upsert: true, new: true }
      );
      savedResults.push(result);
    }

    res.json({
      message: 'Results synced successfully',
      results: savedResults,
      currentGPA: calculateGPA(savedResults)
    });
  } catch (error) {
    console.error('Error syncing results:', error);
    if (error.message.includes('PESU Academy login failed')) {
      return res.status(401).json({ error: 'PESU Academy login failed. Please verify your credentials.' });
    }
    res.status(500).json({ error: error.message || 'Failed to sync results' });
  }
});

// Calculate required marks for target GPA
router.post('/calculate-gpa', auth, async (req, res) => {
  try {
    const { semester, targetGPA } = req.body;
    const results = await Result.find({
      userId: req.user._id,
      semester: parseInt(semester)
    });

    // Simplified calculation
    const calculations = results.map(result => {
      const currentTotal = result.total;
      const currentPercentage = (currentTotal / result.maxMarks) * 100;
      const neededPercentage = parseFloat(targetGPA) * 10; // Rough conversion
      const neededTotal = (neededPercentage / 100) * result.maxMarks;
      const neededInESE = Math.max(0, neededTotal - (result.ia1 + result.ia2));

      return {
        subjectCode: result.subjectCode,
        subjectName: result.subjectName,
        currentTotal,
        neededInESE: Math.round(neededInESE)
      };
    });

    res.json({ calculations });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

