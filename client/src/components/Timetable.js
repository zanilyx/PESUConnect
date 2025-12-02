import React, { useEffect, useState } from 'react';
import axios from 'axios';

const Timetable = ({ compact = false, mode = 'week' }) => {
  const [timetable, setTimetable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentDayIndex, setCurrentDayIndex] = useState(() => {
    const day = new Date().getDay();
    return day >= 1 && day <= 6 ? day - 1 : 0;
  });

  useEffect(() => {
    fetchTimetable();
  }, []);

  const fetchTimetable = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axios.get('/api/timetable', {
        withCredentials: true
      });
      setTimetable(res.data?.timetable || []);
    } catch (err) {
      console.error('Failed to fetch timetable:', err);
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const getVisibleDays = () => {
    if (!timetable.length) return [];
    if (mode === 'day') {
      return [timetable[currentDayIndex % timetable.length]];
    }
    return timetable;
  };
  const visibleDays = getVisibleDays();

  if (loading) {
    return <div className="card">Loading timetable...</div>;
  }

  return (
    <div className="card" style={{ marginTop: '12px' }} data-key="timetable">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="title">Class Timetable</div>
          <div className="sub">
            {mode === 'day'
              ? 'Today’s schedule (navigate to view other days)'
              : 'Live schedule fetched from PESU Academy.'}
          </div>
        </div>
        <button className="btn ghost" onClick={fetchTimetable} style={{ fontSize: '13px', padding: '6px 10px' }}>
          Refresh
        </button>
      </div>

      {mode === 'day' && timetable.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'center' }}>
          <button
            className="btn ghost"
            onClick={() => setCurrentDayIndex((prev) => (prev - 1 + timetable.length) % timetable.length)}
            style={{ padding: '4px 8px' }}
          >
            ‹ Prev
          </button>
          <div className="muted" style={{ alignSelf: 'center' }}>
            {timetable[currentDayIndex].day}
          </div>
          <button
            className="btn ghost"
            onClick={() => setCurrentDayIndex((prev) => (prev + 1) % timetable.length)}
            style={{ padding: '4px 8px' }}
          >
            Next ›
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: '12px',
            padding: '12px',
            background: '#fee',
            color: '#c33',
            borderRadius: '8px',
            fontSize: '14px'
          }}
        >
          {error}
        </div>
      )}

      {visibleDays.map((day, dayIndex) => (
        <div key={day.day} style={{ marginTop: dayIndex > 0 ? '24px' : '0' }}>
          <div style={{
            fontSize: '16px',
            fontWeight: 600,
            marginBottom: '12px',
            paddingBottom: '8px',
            borderBottom: '2px solid var(--border, #e5e7eb)',
            color: 'var(--text, #111827)'
          }}>
            {day.day}
          </div>
          <table className="table timetable-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Time</th>
                <th>Subject</th>
                {mode !== 'day' && <th style={{ width: '160px' }}>Faculty</th>}
              </tr>
            </thead>
            <tbody>
              {day.periods.length === 0 && (
                <tr>
                  <td colSpan={mode !== 'day' ? 3 : 2} style={{ textAlign: 'center', color: '#6b7280' }}>
                    No classes
                  </td>
                </tr>
              )}
              {day.periods.map(period => (
                <tr key={`${day.day}-${period.period}`}>
                  <td>{period.time || `Period ${period.period}`}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      {period.shortSubject || period.subject}
                    </div>
                    <div className="mini" style={{ color: '#6b7280' }}>
                      {period.subjectName}
                    </div>
                  </td>
                  {mode !== 'day' && (
                    <td>{period.teacher || '-'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};

export default Timetable;


