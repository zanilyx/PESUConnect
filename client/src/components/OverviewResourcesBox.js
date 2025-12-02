import React, { useState, useEffect } from 'react';
import axios from 'axios';

const OverviewResourcesBox = ({ user, semester, onNavigateToResources }) => {
  const [maxSemesterSubjects, setMaxSemesterSubjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [maxSemester, setMaxSemester] = useState(null);

  useEffect(() => {
    fetchMaxSemesterSubjects();
  }, []);

  const fetchMaxSemesterSubjects = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;

      // First get semesters to find max semester
      let semesters = [];
      try {
        const cacheRes = await axios.get('/api/resources/semesters/cached', {
          withCredentials: true,
          headers
        });
        if (cacheRes.data?.semesters?.length) {
          semesters = cacheRes.data.semesters;
        }
      } catch (cacheError) {
        const liveRes = await axios.get('/api/resources/html/semesters', {
          withCredentials: true,
          headers
        });
        if (liveRes.data?.semesters?.length) {
          semesters = liveRes.data.semesters;
        }
      }

      if (semesters.length === 0) return;

      // Find max semester
      const maxSem = semesters.reduce((max, sem) => {
        return (sem.semNumber || 0) > (max.semNumber || 0) ? sem : max;
      }, semesters[0]);

      setMaxSemester(maxSem);

      // Fetch subjects for max semester
      const subjectsRes = await axios.post('/api/resources/subjects', 
        { semesterId: maxSem.semId },
        {
          withCredentials: true,
          headers: headers,
        }
      );

      if (subjectsRes.data?.subjects) {
        setMaxSemesterSubjects(subjectsRes.data.subjects);
      }
    } catch (error) {
      console.error('Failed to fetch max semester subjects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubjectClick = (subject) => {
    if (onNavigateToResources && subject.courseId) {
      onNavigateToResources({
        semester: maxSemester?.semNumber || semester,
        semesterId: maxSemester?.semId,
        subject: subject
      });
    }
  };

  return (
    <div className="card small" data-key="resources-overview">
      <div className="title">Resources <span className="tag">Sem {maxSemester?.semNumber || semester}</span></div>
      <div className="sub">Quick access to subjects from your latest semester.</div>
      {loading ? (
        <div style={{ marginTop: '12px', textAlign: 'center', color: 'var(--muted)' }}>
          Loading subjects...
        </div>
      ) : maxSemesterSubjects.length > 0 ? (
        <div style={{ marginTop: '12px' }}>
          <div className="mini" style={{ marginBottom: '6px' }}>Subjects</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {maxSemesterSubjects.slice(0, 5).map((subj, idx) => (
              <div
                key={idx}
                onClick={() => handleSubjectClick(subj)}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(0,0,0,0.06)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  backgroundColor: 'rgba(0,0,0,0.02)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.05)';
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.02)';
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.06)';
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '13px' }}>{subj.code}</div>
                <div className="mini" style={{ marginTop: '2px' }}>{subj.name}</div>
              </div>
            ))}
          </div>
          {maxSemesterSubjects.length > 5 && (
            <div className="mini" style={{ marginTop: '8px', textAlign: 'center', color: 'var(--muted)' }}>
              +{maxSemesterSubjects.length - 5} more subjects
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: '12px', textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
          No subjects found
        </div>
      )}
    </div>
  );
};

export default OverviewResourcesBox;

