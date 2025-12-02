import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSemesterId } from '../hooks/useSemesterId';

const Results = ({ user, semester, compact = false }) => {
  const [results, setResults] = useState(null);
  const [gpa, setGpa] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState(null);
  const { semesterId, loading: semesterIdLoading, error: semesterIdError, reload: reloadSemesterId } = useSemesterId(semester);

  useEffect(() => {
    if (semesterIdError) {
      setError(semesterIdError);
    }
  }, [semesterIdError]);

  useEffect(() => {
    if (semester) {
      fetchResults();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semester]);

  const fetchResults = async () => {
    if (!semester) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      // First, fetch cached results immediately
      const cachedRes = await axios.get(`/api/results/${semester}`, {
        withCredentials: true,
        headers
      });
      
      // Display cached results immediately
      if (cachedRes.data?.results?.length > 0) {
        setResults(cachedRes.data.results);
        setGpa(cachedRes.data.currentGPA || 0);
        setLoading(false);
      } else {
        setLoading(false);
        setError('No results found. Syncing in background...');
      }
      
      // Then sync in background (if we have semesterId)
      if (semesterId) {
        syncResultsInBackground(semesterId);
      } else {
        // Try to get semesterId and then sync
        const targetSemesterId = await reloadSemesterId();
        if (targetSemesterId) {
          syncResultsInBackground(targetSemesterId);
        }
      }
    } catch (error) {
      console.error('Failed to fetch cached results:', error);
      setError('Failed to fetch results: ' + (error.response?.data?.error || error.message));
      setLoading(false);
    }
  };

  const syncResultsInBackground = async (targetSemesterId) => {
    try {
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      // Sync results from PESU Academy in background
      const syncRes = await axios.post('/api/results/sync', {
        semesterId: targetSemesterId,
        semesterNumber: semester
      }, {
        withCredentials: true,
        headers
      });
      
      // Only update if data is different (silent replacement)
      if (syncRes.data?.results?.length > 0) {
        const newResults = syncRes.data.results || [];
        const newGpa = syncRes.data.currentGPA || 0;
        
        // Compare with current results
        const currentResults = results || [];
        const resultsChanged = 
          newResults.length !== currentResults.length ||
          newResults.some((newR, idx) => {
            const oldR = currentResults[idx];
            return !oldR || 
              oldR.ia1 !== newR.ia1 || 
              oldR.ia2 !== newR.ia2 || 
              oldR.ese !== newR.ese || 
              oldR.total !== newR.total;
          });
        
        // Silently replace if different
        if (resultsChanged) {
          setResults(newResults);
          setGpa(newGpa);
          setLastSync(new Date());
        }
      }
    } catch (error) {
      // Silently fail background sync - don't show error to user
      console.error('Background sync failed:', error);
    }
  };

  const formatPercentage = (total, maxMarks) => {
    if (!maxMarks || maxMarks === 0) return '0.00%';
    const percentage = (total / maxMarks) * 100;
    return percentage.toFixed(2) + '%';
  };

  if (compact) {
    return (
      <div className="card" data-key="results">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="title">Results <span className="tag">Live</span></div>
            <div className="sub">Your academic performance.</div>
          </div>
          {lastSync && (
            <div className="muted">Last sync: {lastSync.toLocaleTimeString()}</div>
          )}
        </div>
        {loading || semesterIdLoading ? (
          <div style={{ marginTop: '12px', textAlign: 'center', padding: '20px' }}>
            <div className="muted">Loading results...</div>
          </div>
        ) : error ? (
          <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', color: '#dc2626' }}>
            {error}
          </div>
        ) : results && results.length > 0 ? (
          <div style={{ marginTop: '12px' }}>
            <div className="stat-row">
              <div className="stat">
                <div className="muted">Current GPA</div>
                <h2>{gpa ? gpa.toFixed(2) : 'N/A'}</h2>
              </div>
              <div className="stat">
                <div className="muted">Subjects</div>
                <h2>{results.length}</h2>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: '12px', padding: '12px', textAlign: 'center', color: '#6b7280' }}>
            No results available for this semester.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: '12px' }} data-key="results">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="title">Results <span className="tag">Live</span></div>
          <div className="sub">Your academic performance and GPA.</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {lastSync && (
            <div className="muted">Last sync: {lastSync.toLocaleString()}</div>
          )}
        </div>
      </div>

      {loading || semesterIdLoading ? (
        <div style={{ marginTop: '12px', textAlign: 'center', padding: '40px' }}>
          <div className="muted">Loading results...</div>
        </div>
      ) : error ? (
        <div style={{ marginTop: '12px', padding: '16px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', color: '#dc2626' }}>
          {error}
        </div>
      ) : results && results.length > 0 ? (
        <>
          <div className="stat-row" style={{ marginTop: '12px' }}>
            <div className="stat">
              <div className="muted">Current GPA</div>
              <h2>{gpa ? gpa.toFixed(2) : 'N/A'}</h2>
            </div>
            <div className="stat">
              <div className="muted">Total Subjects</div>
              <h2>{results.length}</h2>
            </div>
          </div>

          <div style={{ marginTop: '20px' }}>
            <div className="title">Subject-wise Results</div>
            <table className="table" style={{ marginTop: '12px' }}>
              <thead>
                <tr>
                  <th>Course Code</th>
                  <th>Course Name</th>
                  <th>IA1</th>
                  <th>IA2</th>
                  <th>ESE</th>
                  <th>Total</th>
                  <th>Percentage</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, idx) => (
                  <tr key={idx}>
                    <td><strong>{result.subjectCode}</strong></td>
                    <td>{result.subjectName}</td>
                    <td>{result.ia1 || 0}</td>
                    <td>{result.ia2 || 0}</td>
                    <td>{result.ese || 0}</td>
                    <td><strong>{result.total || 0}</strong></td>
                    <td>{formatPercentage(result.total || 0, result.maxMarks || 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ marginTop: '12px', padding: '20px', textAlign: 'center', color: '#6b7280' }}>
          No results available for this semester.
        </div>
      )}
    </div>
  );
};

export default Results;

