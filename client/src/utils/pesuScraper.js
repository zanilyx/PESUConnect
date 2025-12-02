/**
 * Frontend HTML scraper for PESU Academy data
 * Parses HTML returned from backend endpoints
 */

/**
 * Parse semesters from HTML
 * HTML format: <option value="2969">Sem-3</option><option value="2760">Sem-2</option>...
 */
export function parseSemesters(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const options = doc.querySelectorAll('option');
  
  const semesters = [];
  const seen = new Set();
  
  options.forEach((option) => {
    const value = option.getAttribute('value');
    const text = option.textContent.trim();
    
    if (value) {
      // Clean the value (remove surrounding quotes and whitespace)
      const cleanValue = value.replace(/['"]/g, '').trim();
      if (!cleanValue || seen.has(cleanValue)) {
        return;
      }
      seen.add(cleanValue);
      
      // Extract semester number from label (e.g., "Sem-3" -> 3)
      const semMatch = text.match(/Sem[-\s]*(\d+)/i);
      const semNumber = semMatch ? parseInt(semMatch[1], 10) : null;
      
      semesters.push({
        id: cleanValue,
        label: text,
        sem: semNumber
      });
    }
  });
  
  return semesters;
}

/**
 * Parse subjects from HTML table
 * HTML format: Table with class "table table-hover box-shadow"
 * Rows have onclick="clickOnCourseContent('20967', event)"
 * Structure: Course Code | Course Title | Course Type | Status | Action
 */
export function parseSubjects(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Find the table - it has class "table table-hover box-shadow"
  const table = doc.querySelector('table.table.table-hover.box-shadow') || 
                doc.querySelector('table.table') ||
                doc.querySelector('table');
  
  if (!table) {
    return [];
  }
  
  const subjects = [];
  
  // Extract rows from tbody
  const tbody = table.querySelector('tbody');
  if (tbody) {
    tbody.querySelectorAll('tr').forEach((row) => {
      const cells = [];
      row.querySelectorAll('td').forEach((cell) => {
        // Get text content, removing nested divs
        const text = cell.cloneNode(true);
        const divs = text.querySelectorAll('div');
        divs.forEach(div => div.remove());
        cells.push(text.textContent.trim());
      });
      
      // Extract course ID from onclick attribute
      // Format: onclick="clickOnCourseContent('20967', event)"
      let courseId = null;
      const onclick = row.getAttribute('onclick') || '';
      const onclickMatch = onclick.match(/clickOnCourseContent\s*\(\s*['"](\d+)['"]/i);
      if (onclickMatch) {
        courseId = onclickMatch[1];
      }
      
      // Also try to extract from row ID: id="rowWiseCourseContent_20967"
      if (!courseId) {
        const rowId = row.getAttribute('id') || '';
        const idMatch = rowId.match(/rowWiseCourseContent_(\d+)/i);
        if (idMatch) {
          courseId = idMatch[1];
        }
      }
      
      if (cells.length >= 2 && courseId) {
        subjects.push({
          code: cells[0] || '',
          name: cells[1] || '',
          type: cells[2] || '',
          status: cells[3] || '',
          cells: cells,
          courseId: courseId,
        });
      }
    });
  }
  
  return subjects;
}

/**
 * Parse units from HTML
 * HTML format: Links in #courselistunit with onclick="handleclassUnit('62247')"
 * Structure: <div id="courselistunit"><a onclick="handleclassUnit('62247')">Unit 1: ...</a></div>
 */
export function parseUnits(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const units = [];
  
  // Find unit links in #courselistunit container (it's a <ul> with <li><a> structure)
  const container = doc.querySelector('#courselistunit');
  if (!container) {
    // Fallback: search all links with handleclassUnit
    const allLinks = doc.querySelectorAll('a[onclick*="handleclassUnit"]');
    allLinks.forEach((link) => {
      const text = link.textContent.trim();
      const onclick = link.getAttribute('onclick') || '';
      
      const unitMatch = text.match(/Unit\s*(\d+)/i);
      const unitNumber = unitMatch ? parseInt(unitMatch[1]) : null;
      
      const handleMatch = onclick.match(/handleclassUnit\s*\(\s*['"](\d+)['"]/i);
      if (handleMatch) {
        units.push({
          number: unitNumber,
          title: text,
          unitId: handleMatch[1],
        });
      }
    });
    return units;
  }
  
  // Get all <a> tags within the container (they're inside <li> elements)
  const links = container.querySelectorAll('a');
  
  links.forEach((link) => {
    const text = link.textContent.trim();
    const onclick = link.getAttribute('onclick') || '';
    
    // Extract unit number from text (e.g., "Unit 1" -> 1)
    const unitMatch = text.match(/Unit\s*(\d+)/i);
    const unitNumber = unitMatch ? parseInt(unitMatch[1]) : null;
    
    // Extract unit ID from onclick - format: handleclassUnit('62247')
    let unitId = null;
    const handleMatch = onclick.match(/handleclassUnit\s*\(\s*['"](\d+)['"]/i);
    if (handleMatch) {
      unitId = handleMatch[1];
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
}

/**
 * Parse classes from HTML
 * HTML format: Table with class "table table-bordered table-rowlink"
 * Structure: Class | AV Summary | Live Videos | Slides | Notes | ...
 * Rows have onclick="handleclasscoursecontentunit('uuid', courseId, unitId, classNo, resourceType)"
 */
export function parseClasses(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const classes = [];
  
  // Find the table - it has class "table table-bordered table-rowlink"
  const table = doc.querySelector('table.table.table-bordered.table-rowlink') ||
                doc.querySelector('table.table-bordered') ||
                doc.querySelector('table');
  
  if (!table) {
    return classes;
  }
  
  // Extract headers
  const headers = [];
  const thead = table.querySelector('thead');
  if (thead) {
    thead.querySelectorAll('th').forEach((th) => {
      headers.push(th.textContent.trim());
    });
  }
  
  // Extract rows from tbody or directly from table
  const tbody = table.querySelector('tbody');
  const rows = tbody ? tbody.querySelectorAll('tr') : table.querySelectorAll('tr');
  
  rows.forEach((row, i) => {
    // Skip header row if it's in tbody
    if (i === 0 && !tbody && row.querySelector('th')) {
      return;
    }
    
    const tds = row.querySelectorAll('td');
    if (tds.length === 0) return;
    
    // Extract title from first cell - it might be in a <span class="short-title"> element
    const firstCell = tds[0];
    const shortTitle = firstCell.querySelector('span.short-title');
    const title = shortTitle ? shortTitle.textContent.trim() : firstCell.textContent.trim();
    
    // Extract onclick parameters
    // Format: onclick="handleclasscoursecontentunit('uuid', 'courseId', 'unitId', 'classNo', resourceType, event)"
    // Note: The actual format has 6 parameters, with the last being 'event'
    let args = null;
    const onclick = row.getAttribute('onclick') || tds[0].getAttribute('onclick') || '';
    // Match: handleclasscoursecontentunit('uuid', 'courseId', 'unitId', 'classNo', resourceType, event)
    const handleMatch = onclick.match(/handleclasscoursecontentunit\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*(\d+)\s*,\s*\w+/i);
    if (handleMatch) {
      args = {
        uuid: handleMatch[1],
        courseId: handleMatch[2],
        unitId: handleMatch[3],
        classNo: handleMatch[4],
        resourceType: handleMatch[5],
      };
    }
    
    // Extract resource counts from remaining cells
    // Structure: Class | AV Summary | Live Videos | Slides | Notes | Assignments | QB | QA | MCQs | References
    const resourceCounts = [];
    const resourceLinks = {}; // Keyed by resourceType (from onclick)
    const resourceLinksByColumn = []; // Indexed by column position
    
    for (let j = 1; j < tds.length; j++) {
      const td = tds[j];
      const text = td.textContent.trim();
      
      // Try to extract number from text or links
      let count = '-';
      const link = td.querySelector('a');
      if (link) {
        const linkText = link.textContent.trim();
        const linkOnclick = link.getAttribute('onclick') || '';
        const numMatch = linkText.match(/(\d+)/);
        if (numMatch) {
          count = numMatch[1];
        }
        
        // Parse onclick parameters for resource preview
        // Format: handleclasscoursecontentunit('uuid', 'courseId', 'unitId', 'classNo', type, event)
        let resourceParams = null;
        const linkMatch = linkOnclick.match(/handleclasscoursecontentunit\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*,\s*(\d+)/i);
        if (linkMatch) {
          resourceParams = {
            courseUnitId: linkMatch[1],
            subjectId: linkMatch[2],
            courseContentId: linkMatch[3],
            classNo: linkMatch[4],
            resourceType: linkMatch[5] // This is the actual type from the onclick
          };
        }
        
        if (resourceParams) {
          // Store by resourceType for lookup by type
          resourceLinks[resourceParams.resourceType] = resourceParams;
          // Store by column index for easy access
          resourceLinksByColumn[j - 1] = resourceParams;
        } else {
          resourceLinksByColumn[j - 1] = null;
        }
      } else {
        const numMatch = text.match(/(\d+)/);
        count = numMatch ? numMatch[1] : (text || '-');
        resourceLinksByColumn[j - 1] = null;
      }
      
      resourceCounts.push(count);
    }
    
    if (title) {
      classes.push({
        si: args?.classNo || (i + 1),
        name: title,
        avSummary: resourceCounts[0] || '-',      // Column 1
        liveVideos: resourceCounts[1] || '-',    // Column 2
        slides: resourceCounts[2] || '-',         // Column 3
        notes: resourceCounts[3] || '-',          // Column 4
        assignments: resourceCounts[4] || '-',    // Column 5
        qb: resourceCounts[5] || '-',              // Column 6
        qa: resourceCounts[6] || '-',              // Column 7
        mcqs: resourceCounts[7] || '-',             // Column 8
        references: resourceCounts[8] || '-',     // Column 9
        resourceCounts: resourceCounts,
        resourceLinks: resourceLinks, // Keyed by resourceType
        resourceLinksByColumn: resourceLinksByColumn, // Indexed by column
        args: args,
        onclick: onclick,
      });
    }
  });
  
  return classes;
}

/**
 * Parse attendance from HTML
 * HTML format: Table with class "table box-shadow" and tbody#subjetInfo
 * Structure: Course Code | Course Name | Total Classes (58/76) | Percentage(%)
 */
export function parseAttendance(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  const attendance = [];
  
  // Find the table with class "table box-shadow" and tbody#subjetInfo
  const table = doc.querySelector('table.table.box-shadow');
  if (!table) {
    return attendance;
  }
  
  const tbody = table.querySelector('tbody#subjetInfo');
  if (!tbody) {
    return attendance;
  }
  
  const rows = tbody.querySelectorAll('tr');
  
  rows.forEach((row) => {
    const tds = row.querySelectorAll('td');
    if (tds.length >= 4) {
      const subjectCode = tds[0].textContent.trim();
      const subjectName = tds[1].textContent.trim();
      // Column 2: Total Classes in format "58/76" (attended/total)
      const totalClassesText = tds[2].textContent.trim();
      // Parse "58/76" format
      const classesMatch = totalClassesText.match(/(\d+)\s*\/\s*(\d+)/);
      const attendedClasses = classesMatch ? parseInt(classesMatch[1], 10) : 0;
      const totalClasses = classesMatch ? parseInt(classesMatch[2], 10) : 0;
      
      // Compute precise percentage from counts (avoid rounded percentage from HTML)
      const percentage = totalClasses > 0 ? (attendedClasses / totalClasses) * 100 : 0;
      
      if (subjectCode && subjectName) {
        attendance.push({
          subjectCode,
          subjectName,
          attendedClasses,
          totalClasses,
          percentage
        });
      }
    }
  });
  
  return attendance;
}

