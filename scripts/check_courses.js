const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Course, User } = require('../models');

async function checkCourses() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/alcafyafec');
    const courses = await Course.find({}).lean();
    console.log('--- ALL COURSES IN DB (' + courses.length + ') ---');
    courses.forEach(c => {
      console.log({
        id: c._id,
        title: c.title,
        grade: c.grade,
        term: c.term,
        subject: c.subject,
        teacher: c.teacher,
        isPublished: c.isPublished,
        studentsCount: (c.students || []).length
      });
    });

    const students = await User.find({ role: 'student' }).limit(5).lean();
    console.log('\n--- SAMPLE STUDENTS (' + students.length + ') ---');
    students.forEach(s => {
      console.log({ id: s._id, name: s.name, email: s.email, grade: s.grade });
    });

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

checkCourses();
