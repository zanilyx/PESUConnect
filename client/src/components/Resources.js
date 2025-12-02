import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const Resources = ({ user, semester, compact = false, preselectedSubject, onSubjectSelected }) => {
  const [semesters, setSemesters] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [units, setUnits] = useState([]);
  const [classes, setClasses] = useState([]);
  const [selectedSem, setSelectedSem] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState({});
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const preselectedHandled = useRef(false);

  useEffect(() => {
    fetchSemesters();
  }, []);

  const fetchSubjects = async (semesterId) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      const res = await axios.post('/api/resources/subjects', 
        { semesterId },
        {
          withCredentials: true,
          headers: headers,
        }
      );
      
      if (res.data?.subjects) {
        setSubjects(res.data.subjects);
      }
    } catch (error) {
      console.error('Failed to fetch subjects:', error);
      if (error.response?.status === 401 || error.response?.status === 400) {
        if (error.response.data?.error?.includes('credentials')) {
          window.location.hash = '#settings';
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle preselected subject from Overview
  useEffect(() => {
    if (preselectedSubject && !compact && !preselectedHandled.current) {
      preselectedHandled.current = true;
      
      const handlePreselected = async () => {
        try {
          // Set the semester first
          if (preselectedSubject.semesterId) {
            setSelectedSem(preselectedSubject.semesterId);
            // Fetch subjects for the semester
            await fetchSubjects(preselectedSubject.semesterId);
          }
        } catch (error) {
          console.error('Error fetching subjects for preselected:', error);
          preselectedHandled.current = false; // Reset on error
        }
      };
      
      handlePreselected();
    }
    
    // Reset when preselectedSubject changes
    if (!preselectedSubject) {
      preselectedHandled.current = false;
    }
  }, [preselectedSubject, compact]);
  
  // Watch for subjects changes to match preselected subject
  useEffect(() => {
    if (preselectedSubject && !compact && subjects.length > 0 && preselectedSubject.subject?.courseId) {
      const targetCourseId = preselectedSubject.subject.courseId;
      const matchingSubject = subjects.find(s => s.courseId === targetCourseId);
      
      if (matchingSubject && (!selectedSubject || selectedSubject.courseId !== targetCourseId)) {
        setSelectedSubject(matchingSubject);
        // Notify parent that subject has been selected
        if (onSubjectSelected) {
          setTimeout(() => {
            onSubjectSelected();
            preselectedHandled.current = false; // Mark as handled
          }, 500);
        } else {
          preselectedHandled.current = false;
        }
      }
    }
  }, [subjects, preselectedSubject, compact, selectedSubject, onSubjectSelected]);

  useEffect(() => {
    if (selectedSem && !preselectedSubject) {
      fetchSubjects(selectedSem);
    }
  }, [selectedSem, preselectedSubject]);

  useEffect(() => {
    if (selectedSubject && selectedSubject.courseId) {
      fetchUnits(selectedSubject.courseId);
    }
  }, [selectedSubject]);

  useEffect(() => {
    if (selectedUnit && selectedUnit.unitId) {
      fetchClasses(selectedUnit.unitId);
    }
  }, [selectedUnit]);

  const fetchSemesters = async () => {
    try {
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      const res = await axios.get('/api/resources/html/semesters', {
        withCredentials: true,
        headers: headers,
      });
      
      if (res.data?.semesters) {
        setSemesters(res.data.semesters);
        const currentSem = res.data.semesters.find(s => s.semNumber === semester);
        if (currentSem) {
          setSelectedSem(currentSem.semId);
        }
      }
    } catch (error) {
      console.error('Failed to fetch semesters:', error);
      if (error.response?.status === 401 || error.response?.status === 400) {
        if (error.response.data?.error?.includes('credentials')) {
          window.location.hash = '#settings';
        }
      }
    }
  };

  const fetchUnits = async (courseId) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      const res = await axios.get(`/api/resources/units/${courseId}`, {
        withCredentials: true,
        headers: headers,
      });
      
      if (res.data?.units) {
        setUnits(res.data.units);
      }
    } catch (error) {
      console.error('Failed to fetch units:', error);
      if (error.response?.status === 401 || error.response?.status === 400) {
        if (error.response.data?.error?.includes('credentials')) {
          window.location.hash = '#settings';
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchClasses = async (unitId) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      const res = await axios.get(`/api/resources/classes/${unitId}`, {
        withCredentials: true,
        headers: headers,
      });
      
      if (res.data?.classes) {
        setClasses(res.data.classes);
      }
    } catch (error) {
      console.error('Failed to fetch classes:', error);
      if (error.response?.status === 401 || error.response?.status === 400) {
        if (error.response.data?.error?.includes('credentials')) {
          window.location.hash = '#settings';
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (classItem) => {
    if (!classItem.args || !classItem.args.uuid || !classItem.args.courseId) {
      console.error('Missing required arguments for download:', classItem);
      return;
    }

    try {
      setDownloading(prev => ({ ...prev, [classItem.title]: true }));
      
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      // Get preview to extract doc IDs
      const previewRes = await axios.post('/api/resources/preview', {
        courseUnitId: classItem.args.uuid,
        subjectId: classItem.args.courseId,
        courseContentId: classItem.args.unitId,
        classNo: classItem.args.classNo,
        resourceType: classItem.args.resourceType || '2' // Use resourceType from args, default to '2' (Slides)
      }, {
        withCredentials: true,
        headers: headers
      });
      
      const docIds = previewRes.data?.docIds || [];
      
      if (docIds.length === 0) {
        console.warn('No document IDs found for class:', classItem.title);
        alert('No PDF documents found for this class.');
        return;
      }
      
      
      // Helper function to sanitize filename (remove invalid characters)
      const sanitizeFilename = (name) => {
        return name
          .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid filename characters
          .replace(/\s+/g, '_') // Replace spaces with underscores
          .replace(/_{2,}/g, '_') // Replace multiple underscores with single
          .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
          .substring(0, 200); // Limit length
      };
      
      // Get base filename from class name
      const className = sanitizeFilename(classItem.title || `Class_${classItem.args?.classNo || 'unknown'}`);
      
      // Download each PDF
      for (let i = 0; i < docIds.length; i++) {
        const docId = docIds[i];
        const downloadUrl = `/api/resources/download/${docId}`;
        
        const response = await axios.get(downloadUrl, {
          withCredentials: true,
          headers: headers,
          responseType: 'blob'
        });
        
        // Create download link
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        
        // Get file extension from Content-Disposition or default to .pdf
        const contentDisposition = response.headers['content-disposition'] || '';
        let fileExt = '.pdf';
        let originalFilename = '';
        
        const filenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/) ||
                            contentDisposition.match(/filename="?([^";]+)"?/);
        if (filenameMatch) {
          originalFilename = decodeURIComponent(filenameMatch[1]);
          // Extract extension from original filename
          const extMatch = originalFilename.match(/\.([^.]+)$/);
          if (extMatch) {
            fileExt = '.' + extMatch[1];
          }
        }
        
        // Create filename: className_1.pdf, className_2.pdf, etc. (or just className.pdf if single file)
        const filename = docIds.length > 1 
          ? `${className}_${i + 1}${fileExt}`
          : `${className}${fileExt}`;
        
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        
        // Small delay between downloads
        if (i < docIds.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (error) {
      console.error('Download failed:', error);
      const errorMsg = error.response?.data?.error || error.message || 'Download failed';
      alert(`Download failed: ${errorMsg}`);
    } finally {
      setDownloading(prev => ({ ...prev, [classItem.title]: false }));
    }
  };

  const handleDownloadAll = async () => {
    // Filter classes that have slides in the current unit
    const classesWithSlides = classes.filter(cls => cls.slidesCount > 0 && cls.args);
    
    if (classesWithSlides.length === 0) {
      alert('No classes with PDF slides available to download in this unit.');
      return;
    }

    if (!selectedUnit) {
      alert('Please select a unit first.');
      return;
    }

    try {
      setDownloadingAll(true);
      setDownloadProgress({ current: 0, total: classesWithSlides.length });
      
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      // Helper function to sanitize filename (same as in handleDownload)
      const sanitizeFilename = (name) => {
        return name
          .replace(/[<>:"/\\|?*]/g, '_')
          .replace(/\s+/g, '_')
          .replace(/_{2,}/g, '_')
          .replace(/^_+|_+$/g, '')
          .substring(0, 200);
      };
      
      let totalDownloaded = 0;
      
      // Download all classes sequentially
      for (let i = 0; i < classesWithSlides.length; i++) {
        const cls = classesWithSlides[i];
        
        // Update downloading state for this class (for progress tracking)
        setDownloading(prev => ({ ...prev, [cls.title]: true }));
        
        try {
          // Get preview to extract doc IDs
          const previewRes = await axios.post('/api/resources/preview', {
            courseUnitId: cls.args.uuid,
            subjectId: cls.args.courseId,
            courseContentId: cls.args.unitId,
            classNo: cls.args.classNo,
            resourceType: cls.args.resourceType || '2'
          }, {
            withCredentials: true,
            headers: headers
          });
          
          const docIds = previewRes.data?.docIds || [];
          
          if (docIds.length === 0) {
            console.warn(`No document IDs found for class: ${cls.title}`);
            continue;
          }
          
          // Get base filename from class name
          const className = sanitizeFilename(cls.title || `Class_${cls.args?.classNo || 'unknown'}`);
          
          // Download each PDF for this class
          for (let j = 0; j < docIds.length; j++) {
            const docId = docIds[j];
            const downloadUrl = `/api/resources/download/${docId}`;
            
            const response = await axios.get(downloadUrl, {
              withCredentials: true,
              headers: headers,
              responseType: 'blob'
            });
            
            // Create download link
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            
            // Get file extension
            const contentDisposition = response.headers['content-disposition'] || '';
            let fileExt = '.pdf';
            const filenameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/) ||
                                contentDisposition.match(/filename="?([^";]+)"?/);
            if (filenameMatch) {
              const originalFilename = decodeURIComponent(filenameMatch[1]);
              const extMatch = originalFilename.match(/\.([^.]+)$/);
              if (extMatch) {
                fileExt = '.' + extMatch[1];
              }
            }
            
            // Create filename
            const filename = docIds.length > 1 
              ? `${className}_${j + 1}${fileExt}`
              : `${className}${fileExt}`;
            
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            
            totalDownloaded++;
            
            // Small delay between files
            if (j < docIds.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
          
          // Update progress
          setDownloadProgress({ current: i + 1, total: classesWithSlides.length });
          
          // Small delay between classes
          if (i < classesWithSlides.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`Failed to download class ${cls.title}:`, error);
          // Continue with next class even if one fails
          // Update progress even on failure
          setDownloadProgress({ current: i + 1, total: classesWithSlides.length });
        } finally {
          // Update downloading state when done with this class
          setDownloading(prev => ({ ...prev, [cls.title]: false }));
        }
      }
      
    } catch (error) {
      console.error('Download all failed:', error);
      alert('Some downloads failed. Please check the console for details.');
    } finally {
      setDownloadingAll(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  if (compact) {
    return (
      <div className="card small">
        <div className="title">Resources</div>
        <div className="sub">Connect to PESU Academy to view live resources.</div>
        <p className="muted" style={{ marginTop: '12px' }}>
          Open the full Resources section to browse your semesters, subjects, and classes in real time.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '12px' }} data-key="resources">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="title">Resource Downloader <span className="tag">Live</span></div>
          <div className="sub">Browse semesters, subjects, units and download PDF slides.</div>
        </div>
        <div className="mini">Selected Semester: {semester}</div>
      </div>

      <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '240px 1fr', gap: '12px' }}>
        <div className="preview-sidebar">
          <div style={{ fontWeight: 600, marginBottom: '6px' }}>Semesters</div>
          <ul className="list" style={{ listStyle: 'none', padding: 0, marginBottom: '10px' }}>
            {semesters.map(sem => (
              <li
                key={sem.semId}
                className={selectedSem === sem.semId ? 'active' : ''}
                onClick={() => {
                  setSelectedSem(sem.semId);
                  setSelectedSubject(null);
                  setSelectedUnit(null);
                  setSubjects([]);
                  setUnits([]);
                  setClasses([]);
                }}
                style={{ padding: '8px', borderRadius: '8px', cursor: 'pointer' }}
              >
                {sem.label}
              </li>
            ))}
          </ul>
          <div style={{ fontWeight: 600, marginBottom: '6px' }}>Subjects</div>
          <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
            {subjects.map((subj, idx) => (
              <li
                key={idx}
                className={selectedSubject?.courseId === subj.courseId ? 'active' : ''}
                onClick={() => {
                  setSelectedSubject(subj);
                  setSelectedUnit(null);
                  setUnits([]);
                  setClasses([]);
                }}
                style={{ padding: '8px', borderRadius: '8px', cursor: 'pointer' }}
              >
                <div style={{ fontWeight: 600 }}>{subj.code}</div>
                <div className="mini">{subj.name}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="preview-content">
          <div>
            <div className="title">
              {selectedSubject ? `${selectedSubject.code} — ${selectedSubject.name}` : 'Select a subject'}
            </div>
            <div className="sub">
              {selectedSubject ? 'Choose a unit to view classes and download PDF slides.' : 'Units and classes will appear here.'}
            </div>
          </div>

          {loading && (
            <div style={{ marginTop: '12px', textAlign: 'center', color: 'var(--muted)' }}>
              Loading...
            </div>
          )}

          {selectedSubject && !loading && (
            <>
              <div style={{ marginTop: '12px' }}>
                <div className="mini" style={{ marginBottom: '6px' }}>Units</div>
                <ul className="list" style={{ listStyle: 'none', padding: 0, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {units.map((unit, idx) => (
                    <li
                      key={idx}
                      className={selectedUnit?.unitId === unit.unitId ? 'active' : ''}
                      onClick={() => setSelectedUnit(unit)}
                      style={{ border: '1px solid rgba(0,0,0,0.06)', padding: '8px 10px', borderRadius: '8px', cursor: 'pointer' }}
                    >
                      {unit.title || `Unit ${unit.number || idx + 1}`}
                    </li>
                  ))}
                </ul>
              </div>

              {selectedUnit && (
                <div style={{ marginTop: '12px' }}>
                  <div className="mini" style={{ marginBottom: '6px' }}>Classes (PDF Slides Only)</div>
                  {(() => {
                    // Filter classes that have slides (slidesCount > 0)
                    const classesWithSlides = classes.filter(cls => cls.slidesCount > 0);
                    
                    if (classesWithSlides.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
                          No classes with PDF slides available
                        </div>
                      );
                    }
                    
                    return (
                      <>
                        <table className="table" style={{ width: '100%' }}>
                          <thead>
                            <tr>
                              <th style={{ width: '70px' }}>SI No.</th>
                              <th>Class Name</th>
                              <th style={{ width: '100px' }} className="text-center">Slides</th>
                              <th style={{ width: '120px' }}>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {classesWithSlides.map((cls, idx) => (
                              <tr key={idx}>
                                <td>{cls.args?.classNo || idx + 1}</td>
                                <td>{cls.title}</td>
                                <td className="text-center">{cls.slidesCount || '-'}</td>
                                <td>
                                  <button
                                    className="btn"
                                    onClick={() => handleDownload(cls)}
                                    disabled={downloading[cls.title] || downloadingAll || !cls.args}
                                    style={{ fontSize: '13px', padding: '6px 12px' }}
                                  >
                                    {downloading[cls.title] ? 'Downloading...' : 'Download PDFs'}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ 
                          marginTop: '20px', 
                          padding: '16px',
                          textAlign: 'center',
                          border: '1px solid rgba(0,0,0,0.1)',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(0,0,0,0.02)'
                        }}>
                          <button
                            className="btn"
                            onClick={handleDownloadAll}
                            disabled={downloadingAll || classesWithSlides.length === 0}
                            style={{ 
                              fontSize: '15px', 
                              padding: '12px 24px',
                              fontWeight: 600,
                              backgroundColor: downloadingAll ? '#999' : '#007bff',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: downloadingAll || classesWithSlides.length === 0 ? 'not-allowed' : 'pointer',
                              opacity: downloadingAll || classesWithSlides.length === 0 ? 0.6 : 1,
                              minWidth: '200px'
                            }}
                          >
                            {downloadingAll 
                              ? `Downloading... ${downloadProgress.current}/${downloadProgress.total}` 
                              : `📥 Download All (${classesWithSlides.length} classes)`}
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Resources;

