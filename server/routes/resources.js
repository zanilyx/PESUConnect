/**
 * Resources Routes - Multi-step CLI flow mimicking PESU Academy AJAX requests
 *
 * This module implements the exact scraper flow from refo.py as a REST API:
 *
 * 1. Login
 *    - GET /Academy/ → extract CSRF token from <meta name="csrf-token">
 *    - POST /Academy/j_spring_security_check with j_username + j_password
 *    - Maintains cookies using axios-cookiejar-support (Python equivalent: requests.Session)
 *
 * 2. Get Semesters
 *    - First GET /Academy/s/studentProfilePESU (refreshes session + CSRF)
 *    - Then GET /Academy/a/studentProfilePESU/getStudentSemestersPESU
 *    - Response contains <option> tags with sem IDs
 *
 * 3. Get Subjects for a Semester
 *    - POST /Academy/s/studentProfilePESUAdmin
 *      with { controllerMode: 6403, actionType: 38, id: <semId>, menuId: 653 }
 *    - Response contains HTML table of subjects
 *
 * 4. Parse Subjects
 *    - Extract <td> values
 *    - Extract course_id from onclick("clickOnCourseContent('12345')")
 *
 * 5. Get Course Units
 *    - GET /Academy/s/studentProfilePESUAdmin
 *      with { controllerMode: 6403, actionType: 42, id: <courseId>, menuId: 653 }
 *    - Response contains the "Units" tab HTML (#courselistunit)
 *
 * 6. Parse Units
 *    - Extract text from <a> tags (e.g., "Unit 1")
 *    - Extract unit_id from onclick("handleclassUnit('unitId')")
 *
 * 7. Get Unit Classes (AV, Assignments, Videos, Notes)
 *    - GET /Academy/s/studentProfilePESUAdmin
 *      with { controllerMode: 6403, actionType: 43, coursecontentid: <unitId>, subType: 3, menuId: 653 }
 *    - Response has a table of classes with resource counts
 *
 * 8. Parse Classes
 *    - For each row, extract the arguments passed to:
 *        handleclasscoursecontentunit(uuid, courseId, unitId, classNo, type)
 *      These are needed to fetch preview & documents.
 *
 * 9. Fetch Preview (Document IDs)
 *    - Try actionType=60 first:
 *        GET /Academy/s/studentProfilePESUAdmin?actionType=60&unitid=...&selectedData=...
 *    - If no IDs found → fallback to actionType=343:
 *        GET /Academy/s/studentProfilePESUAdmin?actionType=343&courseunitid=...&classNo=...
 *    - Extract doc IDs via regex: downloadcoursedoc("xxxx-xxxx")
 *
 * 10. Download Files
 *     - GET /Academy/a/referenceMeterials/downloadslidecoursedoc/{docId}
 *     - Save based on filename in Content-Disposition header
 *
 * All requests maintain the same login session via axios-cookiejar-support,
 * exactly like Python's requests.Session().
 */

const express = require('express');
const auth = require('../middleware/auth');
const pesuScraper = require('../services/pesuScraper');
const cheerio = require('cheerio');

const router = express.Router();

const BASE_URL = 'https://www.pesuacademy.com';
const ADMIN_URL = `${BASE_URL}/Academy/s/studentProfilePESUAdmin`;

/**
 * Extract menuId and controllerMode from profile page HTML
 */
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

function parseSemestersFromHTML(html) {
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
    semesters.push({
      semId: cleanValue,
      semNumber,
      label
    });
  });
  return semesters;
}

// Export for use in other routes
module.exports.parseSemestersFromHTML = parseSemestersFromHTML;

// Get cached semesters from user profile
router.get('/semesters/cached', auth, async (req, res) => {
  try {
    if (req.user.semesterCache && req.user.semesterCache.length > 0) {
      return res.json({
        semesters: req.user.semesterCache,
        cached: true,
        updatedAt: req.user.semesterCacheUpdatedAt
      });
    }
    res.status(404).json({ error: 'Semester cache not found' });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch cached semesters' });
  }
});

// Get semesters HTML
router.get('/html/semesters', auth, async (req, res) => {
  try {
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }
    
    const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
    const profileResp = await session.get(`${BASE_URL}/Academy/s/studentProfilePESU`);
    const $profile = cheerio.load(profileResp.data);
    
    const { menuId, controllerMode } = extractMenuInfo($profile, 'courses');
    
    if (!menuId || !controllerMode) {
      return res.status(500).json({ error: 'Could not extract menu information from PESU Academy' });
    }
    
    const response = await session.get(`${BASE_URL}/Academy/a/studentProfilePESU/getStudentSemestersPESU`, {
      headers: {
        'Referer': `${BASE_URL}/Academy/s/studentProfilePESU`,
      },
    });
    
    const parsedSemesters = parseSemestersFromHTML(response.data);
    if (parsedSemesters.length > 0) {
      req.user.semesterCache = parsedSemesters;
      req.user.semesterCacheUpdatedAt = new Date();
      await req.user.save();
    }
    
    res.json({
      html: response.data,
      menuId,
      controllerMode,
      semesters: parsedSemesters
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch semesters' });
  }
});

// Helper function to compare subjects data
function subjectsDataEqual(oldSubjects, newSubjects) {
  if (!oldSubjects || !newSubjects || oldSubjects.length !== newSubjects.length) {
    return false;
  }
  
  const oldMap = new Map();
  oldSubjects.forEach(subj => {
    oldMap.set(subj.courseId, {
      code: subj.code,
      name: subj.name,
      cells: subj.cells
    });
  });
  
  for (const newSubj of newSubjects) {
    const oldSubj = oldMap.get(newSubj.courseId);
    if (!oldSubj) return false;
    if (oldSubj.code !== newSubj.code || oldSubj.name !== newSubj.name) {
      return false;
    }
  }
  
  return true;
}

// Get subjects for a semester (refo.py: actionType=38, POST)
router.post('/subjects', auth, async (req, res) => {
  try {
    const { semesterId } = req.body;
    if (!semesterId) {
      return res.status(400).json({ error: 'Semester ID required' });
    }
    
    // Check cache first - return immediately
    const cleanSemesterId = String(semesterId).replace(/\D/g, '');
    const cachedSubjectsData = req.user.subjectsCache?.find(
      cache => cache.semesterId === cleanSemesterId || cache.semesterId === semesterId
    );
    
    // Return cached data immediately if available
    if (cachedSubjectsData && cachedSubjectsData.subjects && cachedSubjectsData.subjects.length > 0) {
      // Check if cache is from current login session
      const cacheFromCurrentSession = req.user.lastLoginAt && 
        cachedSubjectsData.updatedAt && 
        cachedSubjectsData.updatedAt >= req.user.lastLoginAt;
      
      // If not from current session, fetch in background to check for updates
      if (!cacheFromCurrentSession && req.user.pesuUsername && req.user.pesuPassword) {
        // Fetch in background (don't await)
        setImmediate(async () => {
          try {
            const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
            const profileResp = await session.get(`${BASE_URL}/Academy/s/studentProfilePESU`);
            const $profile = cheerio.load(profileResp.data);
            const { menuId, controllerMode } = extractMenuInfo($profile, 'courses');
            
            if (menuId && controllerMode) {
              const csrfToken = $profile('meta[name="csrf-token"]').attr('content');
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
              
              const html = response.data;
              const $ = cheerio.load(html);
              const container = $('#getStudentSubjectsBasedOnSemesters');
              const searchContainer = container.length > 0 ? container : $('body');
              const table = searchContainer.find('table').first();
              
              if (table.length > 0) {
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
                
                // Only update if data differs
                const oldSubjects = cachedSubjectsData.subjects || [];
                if (!subjectsDataEqual(oldSubjects, subjects) && subjects.length > 0) {
                  const semData = req.user.semesterCache?.find(s => s.semId === cleanSemesterId || s.semId === semesterId);
                  const semesterNumber = semData?.semNumber || parseInt(cleanSemesterId, 10);
                  
                  if (!req.user.subjectsCache) {
                    req.user.subjectsCache = [];
                  }
                  
                  const cacheIndex = req.user.subjectsCache.findIndex(
                    cache => cache.semesterId === cleanSemesterId || cache.semesterId === semesterId
                  );
                  
                  const cacheEntry = {
                    semesterId: cleanSemesterId,
                    semesterNumber: semesterNumber,
                    subjects: subjects,
                    headers: headers,
                    updatedAt: new Date()
                  };
                  
                  if (cacheIndex >= 0) {
                    req.user.subjectsCache[cacheIndex] = cacheEntry;
                  } else {
                    req.user.subjectsCache.push(cacheEntry);
                  }
                  
                  await req.user.save();
                }
              }
            }
          } catch (err) {
            // Silently fail background update
          }
        });
      }
      
      return res.json({ 
        subjects: cachedSubjectsData.subjects, 
        headers: cachedSubjectsData.headers || [],
        cached: true
      });
    }
    
    // No cache, fetch from PESU
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }
    
    const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
    
    // Get profile to extract menu info and CSRF (refo.py lines 106-117)
    const profileResp = await session.get(`${BASE_URL}/Academy/s/studentProfilePESU`);
    const $profile = cheerio.load(profileResp.data);
    const { menuId, controllerMode } = extractMenuInfo($profile, 'courses');
    
    if (!menuId || !controllerMode) {
      return res.status(500).json({ error: 'Could not extract menu information' });
    }
    
    const csrfToken = $profile('meta[name="csrf-token"]').attr('content');
    
    // POST actionType=38 (refo.py lines 119-127) - exact match
    const formData = {
      controllerMode: '6403', // refo.py line 120
      actionType: '38', // refo.py line 121
      id: cleanSemesterId, // refo.py line 122
      menuId: menuId, // refo.py line 123
      ...(csrfToken && { _csrf: csrfToken }) // refo.py line 124
    };
    
    const response = await session.post(ADMIN_URL, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE_URL}/Academy/s/studentProfilePESU`, // refo.py line 113
        ...(csrfToken && { 'X-CSRF-Token': csrfToken }) // refo.py line 117
      }
    });
    
    const html = response.data;
    
    // Log raw response for debugging
    if (!html || typeof html !== 'string') {
      console.error('Subjects response is not HTML. Type:', typeof html, 'Preview:', String(html).substring(0, 200));
      return res.json({ subjects: [], headers: [] });
    }
    
    const $ = cheerio.load(html);
    
    // Find container (refo.py line 131)
    const container = $('#getStudentSubjectsBasedOnSemesters');
    const searchContainer = container.length > 0 ? container : $('body');
    const table = searchContainer.find('table').first();
    
    if (table.length === 0) {
      // Log for debugging
      console.error('No table found in subjects response. Container HTML preview:', searchContainer.html()?.substring(0, 500) || 'No container HTML');
      console.error('Full response preview:', html.substring(0, 1000));
      return res.json({ subjects: [], headers: [] });
    }
    
    // Parse subjects (refo.py lines 129-149) - find all th elements (not just thead)
    const headers = [];
    table.find('th').each((i, th) => {
      const text = $(th).text().trim();
      headers.push(text);
    });
    
    const subjects = [];
    const onclickRe = /(clickoncoursecontent|clickOnCourseContent)\s*\(\s*'?\s*(\d+)\s*'?/i;
    
    // Get table HTML for regex search (like refo.py uses str(tr))
    const tableHtml = table.html() || '';
    
    // Find all tr elements (refo.py line 139) - not just tbody
    table.find('tr').each((i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length === 0) return; // Skip header row or empty rows
      
      const cells = [];
      tds.each((j, td) => {
        const text = $(td).text().trim();
        cells.push(text);
      });
      
      // Extract course_id from onclick (refo.py lines 137-147)
      // Search in the HTML string of the tr element (like str(tr) in Python)
      let courseId = null;
      const $tr = $(tr);
      let match = null;
      
      // Search for onclick in tr, first td, and anchor tags (like refo.py line 230)
      // Try onclick attribute on tr element
      const trOnclick = $tr.attr('onclick');
      if (trOnclick) {
        match = onclickRe.exec(trOnclick);
      }
      
      // Try onclick on first td
      if (!match) {
        const firstTd = $tr.find('td').first();
        const firstTdOnclick = firstTd.attr('onclick');
        if (firstTdOnclick) {
          match = onclickRe.exec(firstTdOnclick);
        }
        
        // Try onclick on anchors in first td
        if (!match) {
          firstTd.find('a').each((j, a) => {
            const aOnclick = $(a).attr('onclick');
            if (aOnclick) {
              match = onclickRe.exec(aOnclick);
              if (match) return false; // break
            }
          });
        }
      }
      
      // Last resort: search in the row's HTML string (reconstruct from cheerio)
      if (!match) {
        // Reconstruct row HTML by getting all attributes and content
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
    
    // Log for debugging if no subjects found
    if (subjects.length === 0) {
      console.error('No subjects parsed. Table found:', table.length > 0);
      console.error('Table HTML preview:', table.html()?.substring(0, 1000) || 'No table HTML');
      console.error('Response preview:', html.substring(0, 1000));
    }
    
    // Get semester number from cache
    const semData = req.user.semesterCache?.find(s => s.semId === cleanSemesterId || s.semId === semesterId);
    const semesterNumber = semData?.semNumber || parseInt(cleanSemesterId, 10);
    
    // Check if cache exists and is from current session
    const cacheFromCurrentSession = req.user.lastLoginAt && 
      cachedSubjectsData?.updatedAt && 
      cachedSubjectsData.updatedAt >= req.user.lastLoginAt;
    
    // Only update cache if data differs AND not from current session
    const oldSubjects = cachedSubjectsData?.subjects || [];
    const dataChanged = !subjectsDataEqual(oldSubjects, subjects);
    
    if (dataChanged && subjects.length > 0 && !cacheFromCurrentSession) {
      // Update cache
      if (!req.user.subjectsCache) {
        req.user.subjectsCache = [];
      }
      
      const cacheIndex = req.user.subjectsCache.findIndex(
        cache => cache.semesterId === cleanSemesterId || cache.semesterId === semesterId
      );
      
      const cacheEntry = {
        semesterId: cleanSemesterId,
        semesterNumber: semesterNumber,
        subjects: subjects,
        headers: headers,
        updatedAt: new Date()
      };
      
      if (cacheIndex >= 0) {
        req.user.subjectsCache[cacheIndex] = cacheEntry;
      } else {
        req.user.subjectsCache.push(cacheEntry);
      }
      
      await req.user.save();
    }
    
    res.json({ subjects, headers, cached: !!cachedSubjectsData && !dataChanged });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch subjects' });
  }
});

// Get units for a course (refo.py: actionType=42, GET)
router.get('/units/:courseId', auth, async (req, res) => {
  try {
    const { courseId } = req.params;
    
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }
    
    const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
    
    // Get profile to extract menu info and CSRF
    const profileResp = await session.get(`${BASE_URL}/Academy/s/studentProfilePESU`);
    const $profile = cheerio.load(profileResp.data);
    const { menuId, controllerMode } = extractMenuInfo($profile, 'courses');
    
    if (!menuId || !controllerMode) {
      return res.status(500).json({ error: 'Could not extract menu information' });
    }
    
    const csrfToken = $profile('meta[name="csrf-token"]').attr('content');
    
    // GET actionType=42 (refo.py lines 164-171) - exact match
    const params = {
      controllerMode: '6403', // refo.py line 165
      actionType: '42', // refo.py line 166
      id: String(courseId), // refo.py line 167
      menuId: menuId, // refo.py line 168
      ...(csrfToken && { _csrf: csrfToken }) // refo.py line 169
    };
    
    const response = await session.get(ADMIN_URL, {
      params,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE_URL}/Academy/s/studentProfilePESU`,
        ...(csrfToken && { 'X-CSRF-Token': csrfToken })
      }
    });
    
    const $ = cheerio.load(response.data);
    const units = [];
    
    // Extract units from tabs (refo.py lines 173-195)
    const ul = $('#courselistunit').length > 0 ? $('#courselistunit') : $('body');
    
    ul.find('a').each((i, a) => {
      const text = $(a).text().trim();
      const onclick = $(a).attr('onclick') || '';
      const href = $(a).attr('href') || '';
      
      // Extract unit number
      const unitMatch = text.match(/Unit\s*(\d+)/i);
      const unitNumber = unitMatch ? parseInt(unitMatch[1]) : null;
      
      // Extract unit ID
      let unitId = null;
      const handleMatch = onclick.match(/handleclassUnit\s*\(\s*'?(\d+)'?\s*\)/i);
      if (handleMatch) {
        unitId = handleMatch[1];
      } else {
        const hrefMatch = href.match(/courseUnit_(\d+)/);
        if (hrefMatch) {
          unitId = hrefMatch[1];
        }
      }
      
      if (unitId) {
        units.push({
          number: unitNumber,
          title: text,
          unitId
        });
      }
    });
    
    res.json({ units });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch units' });
  }
});

// Get classes for a unit (refo.py: actionType=43, GET with subType=3)
router.get('/classes/:unitId', auth, async (req, res) => {
  try {
    const { unitId } = req.params;
    
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }
    
    const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
    
    // Get profile to extract menu info
    const profileResp = await session.get(`${BASE_URL}/Academy/s/studentProfilePESU`);
    const $profile = cheerio.load(profileResp.data);
    const { menuId, controllerMode } = extractMenuInfo($profile, 'courses');
    
    if (!menuId || !controllerMode) {
      return res.status(500).json({ error: 'Could not extract menu information' });
    }
    
    // GET actionType=43 with subType=3 (refo.py lines 201-209) - exact match
    const params = {
      controllerMode: '6403', // refo.py line 202
      actionType: '43', // refo.py line 203
      coursecontentid: String(unitId), // refo.py line 204
      menuId: menuId, // refo.py line 205
      subType: '3', // refo.py line 206
      _: String(Date.now()) // refo.py line 207 (timestamp as string)
    };
    
    const response = await session.get(ADMIN_URL, {
      params,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${BASE_URL}/Academy/s/studentProfilePESU`
      }
    });
    
    const $ = cheerio.load(response.data);
    const table = $('table').first();
    
    if (table.length === 0) {
      return res.json({ classes: [], headers: [] });
    }
    
    // Parse classes (refo.py lines 211-254)
    const headers = [];
    const thead = table.find('thead');
    if (thead.length > 0) {
      thead.find('th').each((i, th) => {
        headers.push($(th).text().trim());
      });
    } else {
      table.find('th').each((i, th) => {
        headers.push($(th).text().trim());
      });
    }
    
    const classes = [];
    const onclickRe = /handleclasscoursecontentunit\s*\(\s*'([^']+)'\s*,\s*'?(.*?)'?\s*,\s*'?(.*?)'?\s*,\s*'?(.*?)'?\s*,\s*'?(.*?)'?/i;
    
    const tbody = table.find('tbody');
    const rows = tbody.length > 0 ? tbody.find('tr') : table.find('tr');
    
    rows.each((i, tr) => {
      const tds = $(tr).find('td');
      if (tds.length === 0) return;
      
      const title = $(tds[0]).text().trim();
      
      // Extract args from onclick (refo.py lines 228-236) - search in tr, first td, and anchor tags
      let args = null;
      const trHtml = $(tr).html() || '';
      let match = onclickRe.exec(trHtml);
      if (match) {
        args = match.slice(1);
      } else {
        // Try first td element (refo.py checks tds[0])
        const firstTd = $(tds[0]);
        const firstTdHtml = firstTd.html() || '';
        match = onclickRe.exec(firstTdHtml);
        if (match) {
          args = match.slice(1);
        } else {
          // Try all anchor tags in first td (refo.py: tds[0].find_all("a"))
          firstTd.find('a').each((j, a) => {
            const onclick = $(a).attr('onclick') || '';
            const m = onclickRe.exec(onclick);
            if (m) {
              args = m.slice(1);
              return false; // break
            }
          });
        }
      }
      
      // Get resource counts (refo.py lines 237-242) - exact match
      const resourceCounts = [];
      tds.slice(1).each((j, td) => {
        const a = $(td).find('a');
        const txt = a.length > 0 ? $(a).text().trim() : $(td).text().trim();
        const cnt = txt.match(/(\d+)/);
        resourceCounts.push(cnt ? cnt[1] : (txt || '-')); // refo.py line 242
      });
      
      // Find slides column index by checking headers (like refo.py would)
      let slidesIdx = null;
      for (let i = 0; i < headers.length; i++) {
        if (headers[i] && headers[i].toLowerCase().includes('slide')) {
          slidesIdx = i - 1; // -1 because resourceCounts starts after title column
          break;
        }
      }
      
      // Get slides value (refo.py line 488) - use index 2 if slides column not found
      const slidesVal = (slidesIdx !== null && slidesIdx >= 0 && slidesIdx < resourceCounts.length) 
        ? resourceCounts[slidesIdx] 
        : (resourceCounts[2] || '-');
      
      // Include all classes (refo.py doesn't filter), but mark slides count
      classes.push({
        title,
        classNo: args ? args[3] : null,
        courseUnitId: args ? args[0] : null, // uuid in refo.py
        subjectId: args ? args[1] : null, // courseId in refo.py
        courseContentId: args ? args[2] : null, // unitId in refo.py
        resourceType: args && args[4] ? args[4] : '2', // Default to type=2 (Slides/PDFs)
        slidesCount: (slidesVal !== '-' && slidesVal !== '0') ? parseInt(slidesVal) || 0 : 0,
        resourceCounts, // Include all resource counts like refo.py
        args: args ? {
          uuid: args[0], // refo.py line 247
          courseId: args[1], // refo.py line 248
          unitId: args[2], // refo.py line 249
          classNo: args[3], // refo.py line 250
          resourceType: args[4] || '2' // refo.py line 251
        } : null
      });
    });
    
    res.json({ classes, headers });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch classes' });
  }
});

// Get preview HTML and extract doc IDs (refo.py: actionType=60 or 343)
router.post('/preview', auth, async (req, res) => {
  try {
    const { courseUnitId, subjectId, courseContentId, classNo, resourceType = '2' } = req.body;
    
    if (!courseUnitId || !subjectId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }
    
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }
    
    const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
    
    // Get profile to extract menu info and CSRF
    const profileResp = await session.get(`${BASE_URL}/Academy/s/studentProfilePESU`);
    const $profile = cheerio.load(profileResp.data);
    const { menuId } = extractMenuInfo($profile, 'courses');
    
    if (!menuId) {
      return res.status(500).json({ error: 'Could not extract menu information' });
    }
    
    const csrfToken = $profile('meta[name="csrf-token"]').attr('content');
    
    // Try actionType=60 first (refo.py lines 281-294) - exact match
    const params60 = {
      controllerMode: '6403', // refo.py line 282
      actionType: '60', // refo.py line 283
      selectedData: String(subjectId), // refo.py line 284
      id: '2', // refo.py line 285
      unitid: String(courseUnitId), // refo.py line 286
      menuId: menuId, // refo.py line 287
      _: String(Date.now()) // refo.py line 288 (timestamp as string)
    };
    
    const headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${BASE_URL}/Academy/s/studentProfilePESU`,
      ...(csrfToken && { 'X-CSRF-Token': csrfToken })
    };
    
    let html = '';
    let docIds = [];
    
    try {
      const response60 = await session.get(ADMIN_URL, {
        params: params60,
        headers,
        timeout: 30000
      });
      html = response60.data || '';
      
      // Extract doc IDs (refo.py line 292) - exact regex match
      const docIdMatches = html.match(/downloadcoursedoc\s*\(\s*['"]([a-f0-9\-]{6,})['"]/gi);
      if (docIdMatches && docIdMatches.length > 0) {
        docIds = [...new Set(docIdMatches.map(m => {
          const idMatch = m.match(/['"]([a-f0-9\-]{6,})['"]/);
          return idMatch ? idMatch[1] : null;
        }).filter(Boolean))]; // refo.py uses set() to deduplicate
      }
    } catch (err) {
      // Fallback to actionType=343 if 60 fails
    }
    
    // Fallback to actionType=343 if no doc IDs found (refo.py lines 296-315) - exact match
    if (docIds.length === 0 && courseContentId && classNo) {
      const params343 = {
        controllerMode: '9978', // refo.py line 299
        actionType: '343', // refo.py line 300
        courseunitid: String(courseUnitId), // refo.py line 301
        subjectid: String(subjectId), // refo.py line 302
        coursecontentid: String(courseContentId), // refo.py line 303
        classNo: String(classNo), // refo.py line 304
        type: String(resourceType), // refo.py line 305
        menuId: menuId, // refo.py line 306
        selectedData: '0', // refo.py line 307
        _: String(Date.now()) // refo.py line 308 (timestamp as string)
      };
      
      try {
        const response343 = await session.get(ADMIN_URL, {
          params: params343,
          headers,
          timeout: 30000
        });
        html = response343.data || html;
        
        // Extract doc IDs (refo.py lines 312-314) - exact regex match
        let docIdMatches = html.match(/downloadcoursedoc\s*\(\s*['"]([a-f0-9\-]{6,})['"]/gi);
        if (!docIdMatches || docIdMatches.length === 0) {
          docIdMatches = html.match(/href=['"][^'"]*download(?:slide)?coursedoc\/([a-f0-9\-]{6,})/gi); // refo.py line 314
        }
        if (docIdMatches && docIdMatches.length > 0) {
          docIds = [...new Set(docIdMatches.map(m => {
            const idMatch = m.match(/['"]([a-f0-9\-]{6,})['"]/) || m.match(/\/([a-f0-9\-]{6,})/);
            return idMatch ? idMatch[1] : null;
          }).filter(Boolean))]; // refo.py uses set() to deduplicate
        }
      } catch (err) {
        // Silently fail
      }
    }
    
    res.json({ html, docIds });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to fetch preview' });
  }
});

// Download PDF by doc ID (refo.py: download_by_ids)
router.get('/download/:docId', auth, async (req, res) => {
  try {
    const { docId } = req.params;
    
    if (!req.user.pesuUsername || !req.user.pesuPassword) {
      return res.status(400).json({ error: 'PESU credentials not found. Please login again.' });
    }
    
    const session = await pesuScraper.login(req.user.pesuUsername, req.user.pesuPassword);
    
    // Download URL (refo.py line 328) - exact match
    const downloadUrl = `${BASE_URL}/Academy/a/referenceMeterials/downloadslidecoursedoc/${docId}`;
    
    const response = await session.get(downloadUrl, {
      headers: {
        'Referer': `${BASE_URL}/Academy/s/studentProfilePESU`, // refo.py line 323
        'X-Requested-With': 'XMLHttpRequest', // refo.py line 324
        'User-Agent': 'Mozilla/5.0 (compatible; PESU-Scraper/1.0)' // refo.py line 325
      },
      responseType: 'stream',
      maxRedirects: 100, // refo.py line 329 (allow_redirects=True)
      timeout: 60000 // refo.py line 329 (timeout=60)
    });
    
    // Get filename from Content-Disposition (refo.py lines 333-343) - exact match
    let filename = null;
    const contentDisposition = response.headers['content-disposition'] || '';
    
    // Try UTF-8 encoded filename first (refo.py line 337)
    let filenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/);
    if (filenameMatch) {
      filename = decodeURIComponent(filenameMatch[1]);
    } else {
      // Try regular filename (refo.py line 341)
      filenameMatch = contentDisposition.match(/filename="?([^";]+)"?/);
      if (filenameMatch) {
        filename = filenameMatch[1];
      }
    }
    
    // Guess from content-type if no filename (refo.py lines 344-354)
    if (!filename) {
      const contentType = response.headers['content-type'] || '';
      let ext = '.pdf'; // refo.py line 346
      if (contentType.toLowerCase().includes('pdf')) {
        ext = '.pdf';
      } else if (contentType.toLowerCase().includes('word') || contentType.toLowerCase().includes('msword')) {
        ext = '.docx'; // refo.py line 350
      } else if (contentType.toLowerCase().includes('powerpoint') || contentType.toLowerCase().includes('ppt')) {
        ext = '.pptx'; // refo.py line 351
      } else if (contentType.toLowerCase().includes('zip')) {
        ext = '.zip'; // refo.py line 353
      }
      filename = `document${ext}`;
    }
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/pdf');
    response.data.pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to download file' });
  }
});

module.exports = router;
