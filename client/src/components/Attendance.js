import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { parseAttendance } from '../utils/pesuScraper';
import { useSemesterId } from '../hooks/useSemesterId';

const Attendance = ({ user, semester, compact = false }) => {
  const [attendance, setAttendance] = useState(null);
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
    if (semester && semesterId) {
      fetchAttendanceFromPESU();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semester, semesterId]);

  const fetchAttendanceFromPESU = async () => {
    if (!semester) {
      return;
    }

    let targetSemesterId = semesterId;
    if (!targetSemesterId) {
      targetSemesterId = await reloadSemesterId();
      if (!targetSemesterId) {
        return;
      }
    }

    try {
      setLoading(true);
      setError(null);
      
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) headers['x-auth-token'] = token;
      
      // Fetch HTML and parse it - use semesterId, not semester number
      const res = await axios.get(`/api/attendance/html/${targetSemesterId}`, {
        withCredentials: true,
        headers: headers,
        responseType: 'text' // Get raw HTML
      });
      
      const parsedAttendance = parseAttendance(res.data);
      
      setAttendance({
        attendance: parsedAttendance
      });
      setLastSync(new Date());
    } catch (error) {
      console.error('Failed to fetch attendance HTML:', error);
      if (error.response?.status === 401 || error.response?.status === 400) {
        const errorMsg = error.response.data?.error || 'Please login to access attendance';
        setError(errorMsg);
        if (errorMsg.includes('credentials')) {
          window.location.hash = '#settings';
        }
      } else {
        setError('Failed to fetch attendance: ' + (error.response?.data?.error || error.message));
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading && !attendance) {
    return <div className="card">Loading attendance...</div>;
  }

  const formatLastSync = (date) => {
    if (!date) return 'Never';
    const now = new Date();
    const diff = Math.floor((now - new Date(date)) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} mins ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    return `${Math.floor(diff / 86400)} days ago`;
  };

  return (
    <div className="card" data-key="attendance">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="title">Attendance Overview <span className="tag">Live</span></div>
          <div className="sub">Real numbers, not just a percentage.</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {lastSync && <div className="muted">Last sync: {formatLastSync(lastSync)}</div>}
        </div>
      </div>

      {error && (
        <div style={{ 
          marginTop: '12px', 
          padding: '12px', 
          background: '#fee', 
          color: '#c33', 
          borderRadius: '8px',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      {attendance?.attendance && attendance.attendance.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          {!compact && <div className="title">Per-subject attendance</div>}
          <table className="table">
            <thead>
              <tr>
                <th>Course Code</th>
                <th>Course Name</th>
                <th>Attended</th>
                <th>Total</th>
                <th>Percentage</th>
              </tr>
            </thead>
            <tbody>
              {attendance.attendance.map((att, idx) => (
                <tr key={idx}>
                  <td><strong>{att.subjectCode}</strong></td>
                  <td>{att.subjectName}</td>
                  <td>{att.attendedClasses}</td>
                  <td>{att.totalClasses}</td>
                  <td>{att.percentage?.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (!attendance || !attendance.attendance || attendance.attendance.length === 0) && (
        <div style={{ marginTop: '12px', padding: '20px', textAlign: 'center', color: '#666' }}>
          <p>No attendance data found for this semester.</p>
        </div>
      )}
    </div>
  );
};

export default Attendance;

