const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  firstName: String,
  middleName: String,
  thirdName: String,
  lastName: String,
  email: { type: String, unique: true, sparse: true },
  password: { type: String, required: true, select: false },
  phone: { type: String, unique: true, sparse: true },
  grade: String,
  isAzhar: { type: Boolean, default: false },
  parentPhone: String,
  governorate: String,
  gender: String,
  role: { type: String, default: 'student' },
  score: { type: Number, default: 0 },
  // ── Streak ──
  streak: { type: Number, default: 0 },
  maxStreak: { type: Number, default: 0 },
  lastActiveDate: { type: Date, default: null },
  // ── Badges ──
  badges: [{ type: String }],
  // ── Bookmarks ──
  bookmarks: [{
    courseId: String,
    courseTitle: String,
    lessonIndex: Number,
    lessonTitle: String,
    unitTitle: String,
    savedAt: { type: Date, default: Date.now }
  }],
  // ── Password Reset ──
  resetPasswordOtp: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }
}, { timestamps: true });

const courseSchema = new mongoose.Schema({
  title: String,
  description: String,
  price: Number,
  centerPrice: Number,
  instructorId: String,
  instructorName: String,
  students: [String],
  imageUrl: String,
  thumbnail: String,
  content: String,
  grade: String, // '1', '2', '3' to match student grade
  category: String,
  lessonsCount: { type: Number, default: null }, // عدد الدروس المعروض على الكارد
  unitsCount:   { type: Number, default: null }, // عدد الوحدات المعروض على الكارد
  certificatesEnabled: { type: Boolean, default: false }, // إتاحة الشهادة للطلاب عند الإتمام
  lessons: [{
    title: String,
    url: String,
    scheduledAt: { type: Date, default: null },
    pdfUrl: String,
    pdfName: String,
    pdfSize: Number
  }],
  resources: [{
    title: String,
    type: { type: String }, // 'pdf' or 'link'
    url: String,
    importance: { type: String, default: 'normal' } // 'essential' (ضروري) or 'normal' (عادي)
  }],
  units: [{
    title: String,
    lessons: [{
      title: String,
      url: String,
      scheduledAt: { type: Date, default: null },
      pdfUrl: String,
      pdfName: String,
      pdfSize: Number
    }]
  }]
}, { timestamps: true });


const enrollmentRequestSchema = new mongoose.Schema({
  courseId: String,
  courseTitle: String,
  studentId: String,
  studentName: String,
  message: String,
  transferNumber: String,
  paymentImageUrl: String,
  status: { type: String, default: 'pending' }, // pending, approved, rejected
  isCenterStudent: { type: Boolean, default: false },
  discountCode: String,
  discountPercent: Number,
  originalPrice: Number,
  finalPrice: Number
}, { timestamps: true });
enrollmentRequestSchema.index({ studentId: 1, courseId: 1 });
enrollmentRequestSchema.index({ status: 1 });

const reviewSchema = new mongoose.Schema({
  courseId: String,
  userId: String,
  userName: String,
  rating: Number,
  comment: String,
}, { timestamps: true });
reviewSchema.index({ courseId: 1 });


const messageSchema = new mongoose.Schema({
  courseId: String,
  userId: String,
  userName: String,
  text: String,
}, { timestamps: true });
messageSchema.index({ courseId: 1, createdAt: -1 });


const taskSchema = new mongoose.Schema({
  userId: String,
  title: String,
  status: { type: String, default: 'pending' },
}, { timestamps: true });
taskSchema.index({ userId: 1 });


const sessionSchema = new mongoose.Schema({
  userId: String,
  duration: Number,
}, { timestamps: true });
sessionSchema.index({ userId: 1 });


const quizSchema = new mongoose.Schema({
  courseId: String,
  unitTitle: String,
  title: String,
  questions: Array,
}, { timestamps: true });

const submissionSchema = new mongoose.Schema({
  quizId: String,
  courseId: String,
  courseTitle: String,
  userId: String,
  studentName: String,
  studentEmail: String,
  answers: Array,
  score: Number,
  totalScore: Number
}, { timestamps: true });
submissionSchema.index({ userId: 1, courseId: 1 });
submissionSchema.index({ quizId: 1 });


const lessonProgressSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  courseId: { type: String, required: true },
  lessonIndex: { type: Number, required: true },
  completed: { type: Boolean, default: true },
  pointsAwarded: { type: Number, default: 0 }
}, { timestamps: true });
lessonProgressSchema.index({ userId: 1, courseId: 1, lessonIndex: 1 }, { unique: true });

// ── Notes (personal lesson notes per student) ──
const noteSchema = new mongoose.Schema({
  userId:      { type: String, required: true },
  courseId:    { type: String, required: true },
  lessonIndex: { type: Number, required: true },
  lessonTitle: String,
  text:        { type: String, default: '' },
}, { timestamps: true });
noteSchema.index({ userId: 1, courseId: 1, lessonIndex: 1 }, { unique: true });

// ── Discount Codes ──
const discountCodeSchema = new mongoose.Schema({
  code:            { type: String, required: true, unique: true, uppercase: true },
  discountPercent: { type: Number, required: true, min: 1, max: 100 },
  maxUses:         { type: Number, default: 0 }, // 0 = unlimited
  usedCount:       { type: Number, default: 0 },
  expiresAt:       { type: Date, default: null },
  isActive:        { type: Boolean, default: true },
  description:     { type: String, default: '' },
}, { timestamps: true });

// ── Books & Book Orders ──
const bookSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  price: { type: Number, required: true },
  imageUrl: { type: String, default: '' }, // Cover image url
  instructorName: { type: String, required: true }, // Teacher name
  subject: { type: String, required: true }, // "اللغة العربية", "اللغة الإنجليزية", "اللغة الفرنسية"
  importance: { type: String, default: 'normal' }, // 'essential' (ضروري) or 'normal' (عادي)
}, { timestamps: true });

const bookOrderSchema = new mongoose.Schema({
  bookId: { type: String, required: true },
  bookTitle: { type: String, required: true },
  price: { type: Number, required: true },
  studentName: { type: String, required: true }, // الاسم رباعي
  studentPhone: { type: String, required: true }, // الرقم
  deliveryLocation: { type: String, required: true }, // سنتر أو اسم المحافظة
  transferNumber: { type: String, required: true }, // الرقم المحول منه
  paymentImageUrl: { type: String, required: true }, // إيصال الدفع
  subject: { type: String, required: true }, // لتسهيل الفلترة
  status: { type: String, default: 'pending' }, // pending, approved, rejected
}, { timestamps: true });
bookOrderSchema.index({ status: 1 });
bookOrderSchema.index({ subject: 1 });

// ── Live Meetings (Jitsi Meet) ──
const liveMeetingSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  roomName: { type: String, required: true, unique: true },
  courseId: { type: String, default: null },
  courseTitle: { type: String, default: '' },
  grade: { type: String, default: 'all' }, // 'all', '1', '2', '3', 'prep1', 'prep2', 'prep3'
  instructorName: { type: String, default: 'مستر إسلام القيافي' },
  instructorId: { type: String, default: '' },
  scheduledAt: { type: Date, default: Date.now },
  duration: { type: Number, default: 60 }, // minutes
  status: { type: String, default: 'scheduled' }, // 'scheduled', 'live', 'ended'
  password: { type: String, default: '' },
  attendees: [{
    studentId: String,
    studentName: String,
    studentPhone: String,
    joinedAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });
liveMeetingSchema.index({ status: 1, scheduledAt: -1 });
liveMeetingSchema.index({ grade: 1 });
liveMeetingSchema.index({ courseId: 1 });

module.exports = {
  User: mongoose.model('User', userSchema),
  Course: mongoose.model('Course', courseSchema),
  EnrollmentRequest: mongoose.model('EnrollmentRequest', enrollmentRequestSchema),
  Review: mongoose.model('Review', reviewSchema),
  Message: mongoose.model('Message', messageSchema),
  Task: mongoose.model('Task', taskSchema),
  Session: mongoose.model('Session', sessionSchema),
  Quiz: mongoose.model('Quiz', quizSchema),
  Submission: mongoose.model('Submission', submissionSchema),
  LessonProgress: mongoose.model('LessonProgress', lessonProgressSchema),
  Note: mongoose.model('Note', noteSchema),
  DiscountCode: mongoose.model('DiscountCode', discountCodeSchema),
  Book: mongoose.model('Book', bookSchema),
  BookOrder: mongoose.model('BookOrder', bookOrderSchema),
  LiveMeeting: mongoose.model('LiveMeeting', liveMeetingSchema),
};

