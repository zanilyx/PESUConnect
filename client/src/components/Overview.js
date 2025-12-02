import React from 'react';
import Attendance from './Attendance';
import Chat from './Chat';
import Timetable from './Timetable';

const Overview = ({ user, semester, section }) => {

  return (
    <>
      <Attendance user={user} semester={semester} compact={true} />
      <Chat user={user} section={section} compact={true} />
      <Timetable compact={true} mode="day" />
    </>
  );
};

export default Overview;

