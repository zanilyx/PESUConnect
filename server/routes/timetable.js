const express = require('express');
const auth = require('../middleware/auth');
const pesuScraper = require('../services/pesuScraper');
const cheerio = require('cheerio');
const Timetable = require('../models/Timetable');

const router = express.Router();

const STOP_WORDS = new Set(['and', 'or', 'if', 'for', 'of', 'the', 'a', 'an', 'in', 'on', 'its']);

function abbreviateSubject(name = '') {
  return name
    .split(/\s+/)
    .filter(word => word && !STOP_WORDS.has(word.toLowerCase()))
    .map(word => word[0].toUpperCase())
    .join('');
}

function extractMenuInfo($, keyword) {
  let menuId = null;
  let controllerMode = null;
  const menuUl = $('#studentProfilePESUHomeMenu');
  if (menuUl.length > 0) {
    menuUl.find('li').each((i, elem) => {
      const menuName = $(elem).find('.menu-name').text().trim();
      if (menuName && menuName.toLowerCase().includes(keyword.toLowerCase())) {
        const idAttr = $(elem).attr('id') || '';
        const menuMatch = idAttr.match(/menuTab_(\d+)/);
        if (menuMatch) {
          menuId = menuMatch[1];
        }
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
}

function extractJsArray(html, varName) {
  const regex = new RegExp(`${varName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`);
  const match = html.match(regex);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    return null;
  }
}

function extractJsObject(html, varName) {
  const regex = new RegExp(`${varName}\\s*=\\s*(\\{[\\s\\S]*?\\});`);
  const match = html.match(regex);
  if (!match) return null;
  try {
    const normalized = match[1].replace(/'/g, '"');
    return JSON.parse(normalized);
  } catch (error) {
    return null;
  }
}

function parseTimetable(html) {
  const slots = extractJsArray(html, 'timeTableTemplateDetailsJson') || [];
  const table = extractJsObject(html, 'timeTableJson') || {};
  const periodTimes = {};
  slots.forEach(slot => {
    if (slot.timeTableTemplateDetailsStatus === 0) {
      const start = slot.startTime?.split(' ')[0]?.slice(0, 5) || '';
      const end = slot.endTime?.split(' ')[0]?.slice(0, 5) || '';
      periodTimes[slot.orderedBy] = `${start}-${end}`;
    }
  });

  const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timetable = dayNames.map(day => ({
    day,
    periods: []
  }));

  Object.entries(table).forEach(([key, value]) => {
    const match = key.match(/ttDivText_(\d+)_(\d+)_/);
    if (!match) return;
    const dayIndex = parseInt(match[1], 10) - 1;
    const periodNumber = parseInt(match[2], 10);
    const entries = Array.isArray(value) ? value : [value];
    const rawSubjectEntry = entries[0] || '';
    const subjectParts = rawSubjectEntry.split('&&');
    const fullSubject = subjectParts[1] || rawSubjectEntry || '';
    const room = subjectParts[2] || '';
    const teacherEntry = entries[1] || '';
    const teacherParts = teacherEntry.split('&&');
    const teacher = teacherParts[1] || '';

    let subjectCode = '';
    let subjectName = fullSubject;
    if (fullSubject.includes('-')) {
      const splitIndex = fullSubject.indexOf('-');
      subjectCode = fullSubject.slice(0, splitIndex).trim();
      subjectName = fullSubject.slice(splitIndex + 1).trim();
    }

    const abbreviation = abbreviateSubject(subjectName);
    const shortSubject = subjectCode && abbreviation ? `${subjectCode}-${abbreviation}` : fullSubject;
    const teacherClean = teacher.replace(/-+/g, ' ').trim();

    if (timetable[dayIndex]) {
      timetable[dayIndex].periods.push({
        period: periodNumber,
        time: periodTimes[periodNumber] || '',
        shortSubject,
        subjectCode,
        subjectName,
        teacher: teacherClean,
        room: room.trim()
      });
    }

  });

  timetable.forEach(day => {
    day.periods.sort((a, b) => a.period - b.period);
  });

  return timetable;
}

// Export parseTimetable for use in other routes
module.exports.parseTimetable = parseTimetable;
module.exports.extractMenuInfo = extractMenuInfo;

// Helper function to compare timetable data
function timetableDataEqual(oldTimetable, newTimetable) {
  if (!oldTimetable || !newTimetable || oldTimetable.length !== newTimetable.length) {
    return false;
  }
  
  for (let i = 0; i < oldTimetable.length; i++) {
    const oldDay = oldTimetable[i];
    const newDay = newTimetable[i];
    
    if (oldDay.day !== newDay.day || oldDay.periods.length !== newDay.periods.length) {
      return false;
    }
    
    for (let j = 0; j < oldDay.periods.length; j++) {
      const oldPeriod = oldDay.periods[j];
      const newPeriod = newDay.periods[j];
      
      if (oldPeriod.period !== newPeriod.period ||
          oldPeriod.subjectCode !== newPeriod.subjectCode ||
          oldPeriod.subjectName !== newPeriod.subjectName ||
          oldPeriod.teacher !== newPeriod.teacher ||
          oldPeriod.room !== newPeriod.room) {
        return false;
      }
    }
  }
  
  return true;
}

router.get('/', auth, async (req, res) => {
  try {
    // Check for cached timetable first
    const cachedTimetable = await Timetable.findOne({ userId: req.user._id });
    
    // If cached timetable exists, return it immediately
    if (cachedTimetable && cachedTimetable.timetable && cachedTimetable.timetable.length > 0) {
      // Optionally check if we should refresh (only if explicitly requested or cache is very old)
      const forceRefresh = req.query.refresh === 'true';
      const cacheAge = Date.now() - cachedTimetable.updatedAt.getTime();
      const maxCacheAge = 7 * 24 * 60 * 60 * 1000; // 7 days
      
      // If cache is recent and not forcing refresh, return cached data
      if (!forceRefresh && cacheAge < maxCacheAge) {
        return res.json({ timetable: cachedTimetable.timetable, cached: true });
      }
    }

    // If no cache or forcing refresh, fetch from PESU Academy
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      // If no credentials but we have cached data, return that
      if (cachedTimetable && cachedTimetable.timetable && cachedTimetable.timetable.length > 0) {
        return res.json({ timetable: cachedTimetable.timetable, cached: true });
      }
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }

    const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
    const profileResp = await session.get('https://www.pesuacademy.com/Academy/s/studentProfilePESU');
    const $profile = cheerio.load(profileResp.data);
    let { menuId, controllerMode } = extractMenuInfo($profile, 'time table');

    if (!menuId) menuId = '669';
    if (!controllerMode) controllerMode = '6415';

    const html = await pesuScraper.getTimetableHtml(session, menuId, controllerMode);
    const newTimetable = parseTimetable(html);

    // Compare with cached data - only update if different
    const oldTimetable = cachedTimetable?.timetable || [];
    const dataChanged = !timetableDataEqual(oldTimetable, newTimetable);
    
    if (dataChanged || !cachedTimetable) {
      // Save to database (update or create)
      await Timetable.findOneAndUpdate(
        { userId: req.user._id },
        {
          userId: req.user._id,
          timetable: newTimetable,
          updatedAt: new Date()
        },
        { upsert: true, new: true }
      );
    }

    res.json({ timetable: newTimetable, cached: !dataChanged && !!cachedTimetable });
  } catch (error) {
    // If error occurs but we have cached data, return that as fallback
    const cachedTimetable = await Timetable.findOne({ userId: req.user._id });
    if (cachedTimetable && cachedTimetable.timetable && cachedTimetable.timetable.length > 0) {
      return res.json({ timetable: cachedTimetable.timetable, cached: true });
    }

    if (error.message.includes('PESU Academy login failed')) {
      return res.status(401).json({ error: 'PESU Academy login failed. Please verify your credentials.' });
    }
    res.status(500).json({ error: error.message || 'Failed to fetch timetable' });
  }
});

module.exports = router;


