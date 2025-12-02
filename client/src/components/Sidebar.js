import React from 'react';

const Sidebar = ({
  currentView,
  currentSemester,
  currentSection,
  onViewChange,
  onSemesterChange,
  onSectionChange,
  semesters = []
}) => {
  const semesterItems = semesters.length > 0
    ? semesters
    : Array.from({ length: 8 }, (_, i) => ({
        semNumber: i + 1,
        semId: `${i + 1}`,
        label: `Semester ${i + 1}`
      }));

  return (
    <aside className="sidebar">
      <div className="title">Navigation</div>
      <ul className="nav" id="sidebarNav">
        <li
          className={`nav-item ${currentView === 'all' ? 'active' : ''}`}
          onClick={() => onViewChange('all')}
        >
          Overview
        </li>
        <li
          className={`nav-item ${currentView === 'attendance' ? 'active' : ''}`}
          onClick={() => onViewChange('attendance')}
        >
          Attendance
        </li>
        <li
          className={`nav-item ${currentView === 'timetable' ? 'active' : ''}`}
          onClick={() => onViewChange('timetable')}
        >
          Timetable
        </li>
        <li
          className={`nav-item ${currentView === 'resources' ? 'active' : ''}`}
          onClick={() => onViewChange('resources')}
        >
          Resources
        </li>
        <li
          className={`nav-item ${currentView === 'results' ? 'active' : ''}`}
          onClick={() => onViewChange('results')}
        >
          Results
        </li>
        <li
          className={`nav-item ${currentView === 'chat' ? 'active' : ''}`}
          onClick={() => onViewChange('chat')}
        >
          Class Chat
        </li>
        <div className="sidebar-group">Semesters</div>
        {semesterItems.map(sem => (
          <li
            key={sem.semId || sem.semNumber}
            className={`nav-item ${currentSemester === (sem.semNumber ?? sem.sem) ? 'active' : ''}`}
            onClick={() => onSemesterChange(sem.semNumber ?? sem.sem)}
          >
            {sem.label || `Semester ${sem.semNumber ?? sem.sem}`}
          </li>
        ))}
        <div className="sidebar-group">Sections</div>
        {['CS-A', 'CS-B', 'MA-A'].map(section => (
          <li
            key={section}
            className={`nav-item ${currentSection === section ? 'active' : ''}`}
            onClick={() => onSectionChange(section)}
          >
            {section}
          </li>
        ))}
      </ul>
    </aside>
  );
};

export default Sidebar;

