const axios = require('axios');
const cheerio = require('cheerio');
const { URLSearchParams } = require('url');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');

const BASE_URL = 'https://www.pesuacademy.com';
const LOGIN_URL = `${BASE_URL}/Academy/j_spring_security_check`;
const PROFILE_URL = `${BASE_URL}/Academy/s/studentProfilePESU`;
const ADMIN_URL = `${BASE_URL}/Academy/s/studentProfilePESUAdmin`;

/**
 * Create a session with proper headers matching the official site
 */
function createSession() {
  const session = axios.create({
    baseURL: BASE_URL,
    withCredentials: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-IN,en-US;q=0.9,en-GB;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  return session;
}

/**
 * Get CSRF token from a page
 */
async function getCSRFToken(session, url = `${BASE_URL}/Academy/`) {
  try {
    const response = await session.get(url);
    const $ = cheerio.load(response.data);
    const csrfToken = $('meta[name="csrf-token"]').attr('content');
    return csrfToken;
  } catch (error) {
    // CSRF token might not always be needed, return null if not found
    return null;
  }
}

/**
 * Login to PESU Academy (exact match of refo.py implementation)
 * Uses cookie jar to automatically maintain cookies like Python requests.Session()
 */
async function login(username, password) {
  // Create cookie jar (like Python requests.Session() cookie handling)
  const cookieJar = new tough.CookieJar();
  
  // Create session with cookie jar support
  const session = wrapper(axios.create({
    baseURL: BASE_URL,
    jar: cookieJar,
    withCredentials: true,
    maxRedirects: 100, // High limit to allow all redirects
  }));
  
  try {
    // Step 1: GET the login page to extract CSRF token (exactly like refo.py line 85-87)
    const resp = await session.get(`${BASE_URL}/Academy/`);
    
    const $ = cheerio.load(resp.data);
    const csrfToken = $('meta[name="csrf-token"]').attr('content');
    
    if (!csrfToken) {
      throw new Error('CSRF token not found!');
    }
    
    // Step 2: Prepare headers and payload (exactly like the website does)
    // The website form includes both _csrf field AND X-CSRF-Token header
    const headers = {
      'X-CSRF-Token': csrfToken,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': `${BASE_URL}/Academy/`,
    };
    
    // Form fields: _csrf (hidden), j_username, j_password
    // We include _csrf in payload to match the form exactly
    const payload = {
      _csrf: csrfToken,
      j_username: username,
      j_password: password,
    };
    
    // Step 3: POST login (exactly like refo.py line 94)
    // Cookie jar automatically maintains cookies through redirects
    const loginResp = await session.post(LOGIN_URL, payload, {
      headers: headers,
      maxRedirects: 100, // High limit to allow all redirects
      validateStatus: () => true, // Don't throw on any status
    });
    
    // Step 4: Check if login successful (exactly like refo.py line 95)
    // refo.py checks: login_resp.url.endswith("/Academy/s/studentProfilePESU")
    // In axios, we get the final URL after redirects from request.res.responseUrl
    const finalUrl = loginResp.request.res?.responseUrl || 
                    loginResp.request.path || 
                    loginResp.config.url;
    
    // Check if we're logged in - the final URL should end with studentProfilePESU
    const isLoggedIn = finalUrl?.endsWith('/Academy/s/studentProfilePESU') || 
                      finalUrl?.includes('/Academy/s/studentProfilePESU');
    
    if (!isLoggedIn) {
      // Double-check by trying to access profile directly
      // Cookie jar will automatically include cookies
      try {
        const profileCheck = await session.get(PROFILE_URL, {
          maxRedirects: 100, // High limit to allow all redirects
          validateStatus: () => true,
        });
        
        const profileFinalUrl = profileCheck.request.res?.responseUrl || profileCheck.config.url;
        if (profileFinalUrl?.includes('studentProfilePESU') && profileCheck.status === 200) {
          return session;
        }
      } catch (profileError) {
        // Profile check failed - this means login didn't work
      }
      
      throw new Error('Login failed - invalid credentials');
    }
    
    return session;
  } catch (error) {
    if (error.message.includes('Login failed')) {
      throw error;
    }
    throw new Error(`Login error: ${error.message}`);
  }
}

/**
 * Get available semesters
 */
async function getSemesters(session) {
  try {
    // First, visit profile page to establish session
    await session.get(PROFILE_URL);
    
    // Get semesters
    const response = await session.get(`${BASE_URL}/Academy/a/studentProfilePESU/getStudentSemestersPESU`, {
      headers: {
        'Referer': PROFILE_URL,
      },
    });
    
    const $ = cheerio.load(response.data);
    const semesters = [];
    
    $('option').each((i, elem) => {
      const value = $(elem).attr('value');
      const text = $(elem).text().trim();
      if (value) {
        // Try to extract semester number from label
        const semMatch = text.match(/Sem[-\s]*(\d+)/i);
        const semNumber = semMatch ? parseInt(semMatch[1]) : null;
        semesters.push({ 
          id: value, 
          label: text,
          sem: semNumber
        });
      }
    });
    
    return semesters;
  } catch (error) {
    throw new Error(`Failed to get semesters: ${error.message}`);
  }
}

/**
 * Get subjects for a semester
 */
async function getSubjects(session, semesterId) {
  try {
    // Refresh CSRF token (might not be needed, but try anyway)
    const csrfToken = await getCSRFToken(session, PROFILE_URL);
    
    const params = new URLSearchParams({
      controllerMode: '6403',
      actionType: '38',
      id: semesterId.replace(/\D/g, ''), // Clean ID
      menuId: '653',
    });
    
    // Add CSRF token if available
    if (csrfToken) {
      params.append('_csrf', csrfToken);
    }
    
    const response = await session.post(ADMIN_URL,
      params,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': PROFILE_URL,
          ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
        },
      }
    );
    
    const $ = cheerio.load(response.data);
    const subjects = [];
    const table = $('#getStudentSubjectsBasedOnSemesters table');
    
    if (table.length === 0) {
      return subjects;
    }
    
    // Extract headers
    const headers = [];
    table.find('thead th').each((i, elem) => {
      headers.push($(elem).text().trim());
    });
    
    // Extract rows
    table.find('tbody tr').each((i, row) => {
      const cells = [];
      $(row).find('td').each((j, cell) => {
        cells.push($(cell).text().trim());
      });
      
      // Extract course ID from onclick
      let courseId = null;
      const onclick = $(row).attr('onclick') || $(row).html();
      const match = onclick.match(/clickOnCourseContent\s*\(\s*['"]?(\d+)['"]?/i);
      if (match) {
        courseId = match[1];
      }
      
      if (cells.length > 0) {
        subjects.push({
          code: cells[0] || '',
          name: cells[1] || '',
          cells: cells,
          courseId: courseId,
        });
      }
    });
    
    return subjects;
  } catch (error) {
    throw new Error(`Failed to get subjects: ${error.message}`);
  }
}

/**
 * Get units for a course
 */
async function getUnits(session, courseId) {
  try {
    const csrfToken = await getCSRFToken(session, PROFILE_URL);
    
    const params = {
      controllerMode: '6403',
      actionType: '42',
      id: courseId,
      menuId: '653',
    };
    
    if (csrfToken) {
      params._csrf = csrfToken;
    }
    
    const response = await session.get(ADMIN_URL, {
      params: params,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'text/html, */*; q=0.01',
        'Referer': PROFILE_URL,
        ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
      },
    });
    
    const $ = cheerio.load(response.data);
    const units = [];
    
    $('#courselistunit a').each((i, elem) => {
      const text = $(elem).text().trim();
      const onclick = $(elem).attr('onclick') || '';
      
      // Extract unit number
      const unitMatch = text.match(/Unit\s*(\d+)/i);
      const unitNumber = unitMatch ? parseInt(unitMatch[1]) : null;
      
      // Extract unit ID
      let unitId = null;
      const handleMatch = onclick.match(/handleclassUnit\s*\(\s*['"]?(\d+)['"]?/i);
      if (handleMatch) {
        unitId = handleMatch[1];
      } else {
        const hrefMatch = $(elem).attr('href')?.match(/courseUnit_(\d+)/);
        if (hrefMatch) {
          unitId = hrefMatch[1];
        }
      }
      
      if (unitId) {
        units.push({
          number: unitNumber,
          title: text,
          unitId: unitId,
        });
      }
    });
    
    return units;
  } catch (error) {
    throw new Error(`Failed to get units: ${error.message}`);
  }
}

/**
 * Get classes for a unit
 */
async function getClasses(session, unitId) {
  try {
    const response = await session.get(ADMIN_URL, {
      params: {
        controllerMode: '6403',
        actionType: '43',
        coursecontentid: unitId,
        menuId: '653',
        subType: '3',
        _: Date.now(),
      },
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': PROFILE_URL,
      },
    });
    
    const $ = cheerio.load(response.data);
    const classes = [];
    const table = $('table');
    
    if (table.length === 0) {
      return classes;
    }
    
    // Extract headers
    const headers = [];
    table.find('thead th, th').first().parent().find('th').each((i, elem) => {
      headers.push($(elem).text().trim());
    });
    
    // Extract rows
    table.find('tbody tr, tr').each((i, row) => {
      const tds = $(row).find('td');
      if (tds.length === 0) return;
      
      const title = $(tds[0]).text().trim();
      
      // Extract onclick parameters
      let args = null;
      const onclick = $(row).attr('onclick') || $(tds[0]).attr('onclick') || '';
      const handleMatch = onclick.match(/handleclasscoursecontentunit\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?/i);
      if (handleMatch) {
        args = {
          uuid: handleMatch[1],
          courseId: handleMatch[2],
          unitId: handleMatch[3],
          classNo: handleMatch[4],
          resourceType: handleMatch[5],
        };
      }
      
      // Extract resource counts
      const resourceCounts = [];
      tds.slice(1).each((j, td) => {
        const text = $(td).text().trim();
        const countMatch = text.match(/(\d+)/);
        resourceCounts.push(countMatch ? countMatch[1] : text || '-');
      });
      
      classes.push({
        si: args?.classNo || (i + 1),
        name: title,
        slides: resourceCounts[2] || resourceCounts[0] || '-',
        resourceCounts: resourceCounts,
        args: args,
      });
    });
    
    return classes;
  } catch (error) {
    throw new Error(`Failed to get classes: ${error.message}`);
  }
}

/**
 * Get attendance HTML for a semester
 * Matches official function: getStudentAttendancePESUBasedOnSemester
 * controllerMode: 6407, actionType: 8, batchClassId: semesterId
 */
async function getAttendanceHtml(session, semesterId, menuId, controllerMode = '6407') {
  try {
    const csrfToken = await getCSRFToken(session, PROFILE_URL);
    
    // Clean semester ID
    const cleanSemesterId = String(semesterId).replace(/\D/g, '');
    
    // Match official function exactly: POST request with formData
    const formData = new URLSearchParams({
      controllerMode: controllerMode,
      actionType: '8', // Official function uses actionType = 8
      batchClassId: cleanSemesterId, // Official function uses batchClassId (not id)
      menuId: menuId,
    });
    
    if (csrfToken) {
      formData.append('_csrf', csrfToken);
    }
    
    const response = await session.post(ADMIN_URL, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': PROFILE_URL,
        ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
      },
    });
    
    return response.data;
  } catch (error) {
    throw new Error(`Failed to get attendance HTML: ${error.message}`);
  }
}

/**
 * Get results HTML for a semester
 * Matches results_scraper.py (controllerMode: 6402, actionType: 8)
 */
async function getResultsHtml(session, semesterId, menuId = '652', controllerMode = '6402') {
  try {
    const csrfToken = await getCSRFToken(session, PROFILE_URL);

    const formData = new URLSearchParams({
      controllerMode: controllerMode,
      actionType: '8',
      semid: String(semesterId),
      menuId: menuId,
    });

    if (csrfToken) {
      formData.append('_csrf', csrfToken);
    }

    const response = await session.post(ADMIN_URL, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': PROFILE_URL,
        ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(`Failed to get results HTML: ${error.message}`);
  }
}

/**
 * Get timetable HTML (controllerMode 6415, actionType 5)
 */
async function getTimetableHtml(session, menuId = '669', controllerMode = '6415') {
  try {
    const csrfToken = await getCSRFToken(session, PROFILE_URL);

    const params = {
      controllerMode: controllerMode,
      actionType: '5',
      menuId: menuId,
      url: 'studentProfilePESUAdmin',
      id: '0',
      selectedData: '0'
    };

    if (csrfToken) {
      params._csrf = csrfToken;
    }

    const response = await session.get(ADMIN_URL, {
      params,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': PROFILE_URL,
        ...(csrfToken && { 'X-CSRF-Token': csrfToken }),
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(`Failed to get timetable HTML: ${error.message}`);
  }
}

module.exports = {
  login,
  getSemesters,
  getSubjects,
  getUnits,
  getClasses,
  getAttendanceHtml,
  getTimetableHtml,
  getResultsHtml,
};

