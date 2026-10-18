require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
let uploadsDir = path.join(__dirname, 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (err) {
  console.warn('Failed to create local uploads directory, falling back to /tmp/uploads:', err.message);
  uploadsDir = path.join('/tmp', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

const {
  User, Course, EnrollmentRequest, Review, Message, Task, Session, Quiz, Submission, LessonProgress,
  Note, DiscountCode, Book, BookOrder, LiveMeeting
} = require('./models');

const app = express();

// تفعيل CORS الشامل لجميع الأصول والروابط مع السماح بكل الهيدرز
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Access-Control-Allow-Headers', 'Access-Control-Request-Method', 'Access-Control-Request-Headers']
}));

// التعامل السريع مع طلبات Preflight (OPTIONS) لضمان عدم الحظر
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(uploadsDir));


// Database connection middleware for Serverless environment
const connectDB = async (req, res, next) => {
  if (mongoose.connection.readyState === 1) {
    return next();
  }

  try {
    const dbUri = process.env.MONGO_URI;
    if (!dbUri && process.env.VERCEL) {
      return res.status(500).json({
        error: "MONGO_URI is not defined in the environment variables on Vercel. Please add it in your Vercel project settings."
      });
    }

    const connectionString = dbUri || 'mongodb://127.0.0.1:27017/edu_db';

    // If fully disconnected (readyState 0), trigger connect and wait
    if (mongoose.connection.readyState === 0) {
      console.log('Connecting to MongoDB via middleware...');
      await mongoose.connect(connectionString, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000
      });
      console.log('MongoDB Connected successfully.');
      next();
    } else {
      // If state is 2 (connecting), wait for connection to open
      console.log('MongoDB is connecting, waiting for ready event...');
      await new Promise((resolve, reject) => {
        const handleOpen = () => {
          cleanup();
          resolve();
        };
        const handleError = (err) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          mongoose.connection.removeListener('connected', handleOpen);
          mongoose.connection.removeListener('error', handleError);
        };
        mongoose.connection.once('connected', handleOpen);
        mongoose.connection.once('error', handleError);
      });
      next();
    }
  } catch (err) {
    console.error('Database connection error in middleware:', err.message);
    res.status(500).json({
      error: `Failed to connect to the database: ${err.message}`
    });
  }
};

// Apply connectDB middleware to all routes starting with /api
app.use('/api', connectDB);

const JWT_SECRET = process.env.JWT_SECRET || 'alkafyafe_supersecret_jwt_key_2026_fixed_secure';
const ALL_JWT_SECRETS = Array.from(new Set([
  JWT_SECRET,
  'alkafyafe_supersecret_jwt_key_2026_fixed_secure',
  'alkafyafe_supersecret_jwt_key_2026',
  'supersecret123',
  'alkafyafe_supersecret_jwt_key_2026_secure'
]));

// 🛡️ Helper to verify token against primary and legacy secrets with automatic 60-day grace period
function verifyAndDecodeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const cleanToken = token.trim();

  // 1. Try standard verification with primary secret first
  try {
    const user = jwt.verify(cleanToken, JWT_SECRET);
    return { user, refreshedToken: null };
  } catch (err) {
    // If expired under primary secret, check 60-day grace period
    if (err.name === 'TokenExpiredError') {
      try {
        const decoded = jwt.decode(cleanToken);
        if (decoded && decoded.id) {
          const expiredAt = decoded.exp ? decoded.exp * 1000 : 0;
          const gracePeriod = 60 * 24 * 60 * 60 * 1000; // 60 days
          if (Date.now() - expiredAt < gracePeriod) {
            const user = jwt.verify(cleanToken, JWT_SECRET, { ignoreExpiration: true });
            const refreshedToken = jwt.sign(
              { id: user.id, role: user.role, name: user.name, grade: user.grade },
              JWT_SECRET,
              { expiresIn: '90d' }
            );
            return { user, refreshedToken, isGracePeriod: true };
          }
        }
      } catch (e) {}
    }

    // 2. Try fallback legacy secrets (in case server restarted or environment differed)
    for (const secret of ALL_JWT_SECRETS) {
      if (secret === JWT_SECRET) continue;
      try {
        const user = jwt.verify(cleanToken, secret);
        // Valid under legacy secret! Re-sign immediately with primary secret
        const refreshedToken = jwt.sign(
          { id: user.id, role: user.role, name: user.name, grade: user.grade },
          JWT_SECRET,
          { expiresIn: '90d' }
        );
        return { user, refreshedToken };
      } catch (fallbackErr) {
        if (fallbackErr.name === 'TokenExpiredError') {
          try {
            const decoded = jwt.decode(cleanToken);
            if (decoded && decoded.id) {
              const expiredAt = decoded.exp ? decoded.exp * 1000 : 0;
              const gracePeriod = 60 * 24 * 60 * 60 * 1000;
              if (Date.now() - expiredAt < gracePeriod) {
                const user = jwt.verify(cleanToken, secret, { ignoreExpiration: true });
                const refreshedToken = jwt.sign(
                  { id: user.id, role: user.role, name: user.name, grade: user.grade },
                  JWT_SECRET,
                  { expiresIn: '90d' }
                );
                return { user, refreshedToken, isGracePeriod: true };
              }
            }
          } catch (e) {}
        }
      }
    }

    return null;
  }
}

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Connect to MongoDB (Initial connection attempt)
const dbUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/edu_db';
mongoose.connect(dbUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000
}).then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Initial Connection Error:', err.message));

// Middleware for auth (required)
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : authHeader?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized', code: 'NO_TOKEN' });

  const result = verifyAndDecodeToken(token);
  if (!result || !result.user) {
    return res.status(401).json({ 
      error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً', 
      code: 'TOKEN_EXPIRED' 
    });
  }

  req.user = result.user;
  if (result.refreshedToken) {
    res.setHeader('x-refreshed-token', result.refreshedToken);
    res.setHeader('Access-Control-Expose-Headers', 'x-refreshed-token');
  }
  next();
};

// Middleware for optional auth — attaches req.user if token present, otherwise marks token status
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : authHeader?.split(' ')[1];
  if (token) {
    const result = verifyAndDecodeToken(token);
    if (result && result.user) {
      req.user = result.user;
      if (result.refreshedToken) {
        res.setHeader('x-refreshed-token', result.refreshedToken);
        res.setHeader('Access-Control-Expose-Headers', 'x-refreshed-token');
      }
    } else {
      // Client explicitly sent an Authorization header, but token is completely expired (>60 days) or invalid
      req.tokenExpired = true;
    }
  }
  next();
};

// --- Cloudinary Config & Multer Setup ---
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const cloudName = (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_CLOUD_NAME.trim()) || 'dkdiarly1';
const apiKey = (process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_KEY.trim()) || '318637593555331';
const apiSecret = (process.env.CLOUDINARY_API_SECRET && process.env.CLOUDINARY_API_SECRET.trim()) || 'yICB6Yvbcp4Kd_rb5GssgyLH_d8';

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret
});

console.log('✅ Cloudinary Config:', cloudinary.config().cloud_name);

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit for raw mobile camera uploads
});

const uploadSingle = (req, res, next) => {
  const uploadHandler = upload.single('file');
  uploadHandler(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'حجم الملف كبير جداً، الحد الأقصى هو 20 ميجابايت' });
      }
      return res.status(400).json({ error: `خطأ أثناء رفع الملف: ${err.message}` });
    } else if (err) {
      return res.status(500).json({ error: err.message });
    }
    next();
  });
};

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/$/, '');
  }
  if (req) {
    return `${req.protocol}://${req.get('host')}`;
  }
  return `http://localhost:${PORT}`;
}

function saveLocalUpload(file, req) {
  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
  fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);
  return `${getPublicBaseUrl(req)}/uploads/${filename}`;
}

function fixUploadUrl(url, req) {
  if (!url || typeof url !== 'string') return '';
  let trimmed = url.trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('/uploads/')) {
    return `${getPublicBaseUrl(req)}${trimmed}`;
  }

  if (trimmed.includes('/uploads/')) {
    trimmed = trimmed.replace(/https?:\/\/localhost:\d+/i, getPublicBaseUrl(req));
    const uploadPath = trimmed.substring(trimmed.indexOf('/uploads/'));
    return `${getPublicBaseUrl(req)}${uploadPath}`;
  }

  return trimmed;
}

function formatEnrollmentRequest(doc, req) {
  return {
    id: String(doc._id),
    courseId: doc.courseId,
    courseTitle: doc.courseTitle,
    studentId: doc.studentId,
    studentName: doc.studentName,
    message: (doc.message || '').trim(),
    transferNumber: (doc.transferNumber || '').trim(),
    paymentImageUrl: fixUploadUrl(doc.paymentImageUrl, req),
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    isCenterStudent: doc.isCenterStudent || false,
    discountCode: doc.discountCode,
    discountPercent: doc.discountPercent,
    originalPrice: doc.originalPrice,
    finalPrice: doc.finalPrice
  };
}

function uploadToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: 'auto', folder: 'myweb-cit' },
      (error, result) => (error ? reject(error) : resolve(result))
    );
    uploadStream.end(buffer);
  });
}

// Upload Endpoint (Cloudinary with local fallback) - Protected by authMiddleware and type/size check
app.post('/api/upload', authMiddleware, uploadSingle, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم رفع أي ملف' });
  }

  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.heic', '.heif', '.bmp'];
  const allowedMimeTypes = [
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'application/pdf',
    'image/heic', 'image/heif', 'image/pjpeg', 'image/x-png', 'image/bmp', 'application/octet-stream'
  ];
  const ext = path.extname(req.file.originalname).toLowerCase();
  
  if (!allowedExtensions.includes(ext) && !allowedMimeTypes.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'نوع الملف المرفوع غير مسموح به' });
  }

  try {
    const result = await uploadToCloudinary(req.file.buffer);
    const url = result.secure_url || result.url;
    return res.json({ secure_url: url, url, originalName: req.file.originalname, size: req.file.size });
  } catch (error) {
    console.warn('Cloudinary upload failed, attempting local storage:', error.message);
    try {
      const localUrl = saveLocalUpload(req.file, req);
      return res.json({ secure_url: localUrl, url: localUrl, originalName: req.file.originalname, size: req.file.size });
    } catch (localErr) {
      console.warn('Local disk storage failed (serverless environment), returning data URI fallback:', localErr.message);
      const mime = req.file.mimetype || 'image/jpeg';
      const base64Data = req.file.buffer.toString('base64');
      const dataUrl = `data:${mime};base64,${base64Data}`;
      return res.json({ secure_url: dataUrl, url: dataUrl, originalName: req.file.originalname, size: req.file.size });
    }
  }
});

// --- Course Progress and Lesson Completion Routes ---

// Complete/Uncomplete a lesson (+ score)
app.post('/api/courses/:courseId/lessons/:lessonIndex/complete', authMiddleware, async (req, res) => {
  try {
    const { completed } = req.body;
    const userId = req.user.id; // Always use authenticated user ID — never trust body
    const { courseId, lessonIndex } = req.params;
    const idx = parseInt(lessonIndex, 10);

    const existing = await LessonProgress.findOne({ userId, courseId, lessonIndex: idx });

    if (completed === false) {
      const progress = await LessonProgress.findOneAndUpdate(
        { userId, courseId, lessonIndex: idx },
        { completed: false, pointsAwarded: 0 },
        { upsert: true, new: true }
      );
      return res.json({ success: true, progress, pointsAwarded: 0 });
    }

    if (existing?.completed) {
      return res.json({
        success: true,
        progress: existing,
        pointsAwarded: 0,
        alreadyCompleted: true
      });
    }

    let pointsAwarded = 0;
    let progress;

    try {
      // Atomically set completed: true only if it is not already true.
      // If it doesn't exist, it will upsert it. If it was already completed concurrently, 
      // the upsert will trigger a duplicate key error (code 11000) due to the unique index.
      progress = await LessonProgress.findOneAndUpdate(
        { userId, courseId, lessonIndex: idx, completed: { $ne: true } },
        { $set: { completed: true } },
        { upsert: true, new: true }
      );

      const course = await Course.findById(courseId);
      const enrolledIds = (course?.students || []).map(String);

      const priorCompletions = await LessonProgress.countDocuments({
        courseId,
        lessonIndex: idx,
        completed: true,
        pointsAwarded: { $gt: 0 },
        userId: { $ne: userId },
        ...(enrolledIds.length ? { userId: { $in: enrolledIds } } : {})
      });

      pointsAwarded = priorCompletions === 0 ? 20 : 5;

      await User.findByIdAndUpdate(userId, { $inc: { score: pointsAwarded } });

      progress.pointsAwarded = pointsAwarded;
      await progress.save();

    } catch (err) {
      if (err.code === 11000) {
        // Concurrently completed by another request
        const existingDoc = await LessonProgress.findOne({ userId, courseId, lessonIndex: idx });
        return res.json({
          success: true,
          progress: existingDoc,
          pointsAwarded: 0,
          alreadyCompleted: true
        });
      }
      throw err;
    }

    res.json({
      success: true,
      progress,
      pointsAwarded,
      isFirstViewer: pointsAwarded === 20
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Top 10 leaderboard (optional grade filter per academic year)
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { userId, grade } = req.query;
    const filter = { role: { $ne: 'admin' } };
    if (grade) filter.grade = grade;

    const topStudents = await User.find(filter)
      .sort({ score: -1, createdAt: 1 })
      .limit(10)
      .select('name score grade');

    const top10 = topStudents.map((u, i) => ({
      rank: i + 1,
      userId: u._id.toString(),
      name: u.name,
      score: u.score || 0,
      grade: u.grade || ''
    }));

    let myScore = 0;
    let myRank = null;

    if (userId) {
      const me = await User.findById(userId).select('score name grade');
      if (me) {
        myScore = me.score || 0;
        const rankFilter = { role: { $ne: 'admin' }, score: { $gt: myScore } };
        const rankGrade = grade || me.grade;
        if (rankGrade) rankFilter.grade = rankGrade;
        const higherCount = await User.countDocuments(rankFilter);
        myRank = higherCount + 1;
      }
    }

    res.json({ top10, myScore, myRank });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check course progress and certificate eligibility
app.get('/api/courses/:courseId/progress/:userId', authMiddleware, async (req, res) => {
  try {
    const { courseId, userId } = req.params;

    // Only allow user to view their own progress, or admin to view anyone's
    if (userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    // 1. Get Course and total lessons
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ error: 'الكورس غير موجود' });
    }

    // Lessons count — calculate actual total lessons (from units if available, or flat lessons)
    let lessonsCount = 0;
    if (course.units && course.units.length > 0) {
      lessonsCount = course.units.reduce((sum, u) => sum + (u.lessons?.length || 0), 0);
    } else if (course.lessons && course.lessons.length > 0) {
      lessonsCount = course.lessons.length;
    }

    // 2. Get completed lessons for this student in this course (support ObjectId & String matching)
    const completedProgress = await LessonProgress.find({
      $and: [
        { $or: [{ userId: userId }, { userId: String(userId) }] },
        { $or: [{ courseId: courseId }, { courseId: String(courseId) }] },
        {
          $or: [
            { completed: { $ne: false } },
            { pointsAwarded: { $gt: 0 } }
          ]
        }
      ]
    });

    // Total watched documents recorded for this student in this course
    const totalWatchedCount = completedProgress.length;

    // Get direct valid indices strictly within range 0..lessonsCount-1
    let validIndices = Array.from(new Set(
      completedProgress
        .map(p => p.lessonIndex)
        .filter(idx => idx >= 0 && (lessonsCount === 0 || idx < lessonsCount))
    ));

    // If total watched documents count is greater than validIndices count (e.g. legacy offset indices),
    // fill 0..N-1 so all watched videos are 100% credited
    if (lessonsCount > 0 && totalWatchedCount > validIndices.length) {
      const targetCount = Math.min(totalWatchedCount, lessonsCount);
      validIndices = Array.from({ length: targetCount }, (_, i) => i);
    }

    // Score Fallback: If no LessonProgress docs exist yet, check if student earned user.score (e.g. 5 points)
    if (validIndices.length === 0 && lessonsCount > 0) {
      const targetUser = await User.findById(userId).select('score');
      if (targetUser && targetUser.score && targetUser.score > 0) {
        // User earned points (5 or 20 points per video)
        const estimatedCount = Math.min(Math.ceil(targetUser.score / 5), lessonsCount);
        if (estimatedCount > 0) {
          validIndices = Array.from({ length: estimatedCount }, (_, i) => i);
        }
      }
    }

    // If lessonsCount is 0, then we consider the single main video completed
    const allVideosWatched = lessonsCount === 0 || validIndices.length >= lessonsCount;

    // 3. Get all quizzes for this course
    const quizzes = await Quiz.find({ courseId });

    // 4. Get student's submissions for this course (flexible ObjectId & String matching)
    const submissions = await Submission.find({
      $and: [
        { $or: [{ userId: userId }, { userId: String(userId) }] },
        { $or: [{ courseId: courseId }, { courseId: String(courseId) }, { courseId: null }, { courseId: undefined }, { courseId: '' }] }
      ]
    });

    // 5. Check if all quizzes are passed with score >= 70
    let allQuizzesPassed = true;
    const quizDetails = [];

    for (const quiz of quizzes) {
      const quizIdStr = String(quiz._id || quiz.id || '');
      const quizTitleStr = String(quiz.title || '').trim().toLowerCase();

      // Flexible matching by quizId OR by quiz title
      const quizSubs = submissions.filter(s => {
        if (s.quizId && String(s.quizId) === quizIdStr) return true;
        if (s.quizTitle && quizTitleStr && String(s.quizTitle).trim().toLowerCase() === quizTitleStr) return true;
        if (s.title && quizTitleStr && String(s.title).trim().toLowerCase() === quizTitleStr) return true;
        return false;
      });

      const solved = quizSubs.length > 0;
      const maxScoreRaw = solved ? Math.max(...quizSubs.map(s => s.score || 0)) : 0;
      const maxScore = Math.round(maxScoreRaw * 10) / 10;
      const passed = solved && maxScore >= 70;

      if (!passed) {
        allQuizzesPassed = false;
      }

      quizDetails.push({
        quizId: quiz._id,
        title: quiz.title,
        maxScore,
        passed,
        solved
      });
    }

    // Eligibility check
    const certificatesEnabled = course.certificatesEnabled || false;
    const isEligible = allVideosWatched && allQuizzesPassed && certificatesEnabled;

    res.json({
      completedLessons: validIndices,
      totalLessons: lessonsCount,
      allVideosWatched,
      quizzes: quizDetails,
      allQuizzesPassed,
      certificatesEnabled,
      isEligible
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Mark all videos as watched for a student
app.post('/api/admin/courses/:courseId/students/:userId/mark-all-watched', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { courseId, userId } = req.params;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

    let lessonsCount = 0;
    if (course.units && course.units.length > 0) {
      lessonsCount = course.units.reduce((sum, u) => sum + (u.lessons?.length || 0), 0);
    } else if (course.lessons && course.lessons.length > 0) {
      lessonsCount = course.lessons.length;
    }

    for (let i = 0; i < lessonsCount; i++) {
      await LessonProgress.findOneAndUpdate(
        { userId, courseId, lessonIndex: i },
        { $set: { completed: true } },
        { upsert: true, new: true }
      );
    }

    return res.json({ success: true, message: 'تم تعليم جميع الفيديوهات كمشاهدة للطالب بنجاح' });
  } catch (err) {
    res.status(500).json({ error: 'حدث خطأ في الخادم' });
  }
});

// --- Auth Routes ---
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { 
      email, password, name, 
      firstName, middleName, thirdName, lastName,
      phone, grade, isAzhar, parentPhone, governorate, gender 
    } = req.body;

    // Prevent NoSQL Injection by validating input types
    if (
      (email && typeof email !== 'string') ||
      typeof password !== 'string' ||
      typeof name !== 'string' ||
      typeof phone !== 'string'
    ) {
      return res.status(400).json({ error: 'البيانات المرسلة غير صالحة' });
    }
    
    if (!phone) return res.status(400).json({ error: 'رقم الهاتف مطلوب للتسجيل' });

    // Check if phone or email already exists
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) return res.status(400).json({ error: 'رقم الهاتف مسجل بالفعل' });

    if (email) {
      const existingEmail = await User.findOne({ email });
      if (existingEmail) return res.status(400).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('📝 Signup attempt for:', phone, email || '(no email)');
    
    const user = new User({ 
      email: email || undefined, 
      password: hashedPassword, 
      name, 
      role: 'student', // Force 'student' role to prevent privilege escalation
      firstName, middleName, thirdName, lastName,
      phone, grade, isAzhar, parentPhone, governorate, gender
    });

    await user.save();
    console.log('✅ User saved successfully:', user._id);
    
    res.status(201).json({ message: 'User created successfully', uid: user._id });
  } catch (err) {
    console.error('❌ Signup Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;
    
    // Prevent NoSQL Injection by validating input types
    if (typeof identifier !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'بيانات الدخول غير صالحة' });
    }
    
    console.log('🔑 Login attempt for:', identifier);
    
    const user = await User.findOne({ 
      $or: [{ email: identifier }, { phone: identifier }] 
    }).select('+password');
    
    if (!user) {
      console.log('❌ User not found for identifier:', identifier);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('✅ User found:', user.email || user.phone);
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });
    
    // Auto-promote main admin accounts
    const ADMIN_IDENTIFIERS = ['01098744710', 'zm771877@gmail.com', 'admin@almotamayezon.com'];
    if (ADMIN_IDENTIFIERS.includes(user.phone) || (user.email && ADMIN_IDENTIFIERS.includes(user.email))) {
      if (user.role !== 'admin') {
        user.role = 'admin';
        await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
      }
    }

    const token = jwt.sign({ id: user._id, role: user.role, name: user.name, grade: user.grade }, JWT_SECRET, { expiresIn: '90d' });
    res.json({ token, role: user.role, name: user.name, uid: user._id, email: user.email, grade: user.grade, phone: user.phone, parentPhone: user.parentPhone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔑 Forgot Password - Send OTP to user's Gmail/Email
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'يرجى إدخال البريد الإلكتروني الخاص بحسابك.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(404).json({ error: 'عذراً، هذا البريد الإلكتروني غير مسجل في المنصة.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    user.resetPasswordOtp = otp;
    user.resetPasswordExpires = expires;
    await user.save();

    // Send email with nodemailer
    const mailOptions = {
      from: `"منصة المتميزون التعليمية" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: '🔐 رمز إعادة تعيين كلمة المرور - منصة المتميزون',
      html: `
        <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; padding: 25px; border-radius: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; color: #1e293b;">
          <div style="text-align: center; margin-bottom: 25px;">
            <h1 style="color: #0284c7; margin: 0; font-size: 24px; font-weight: 900;">🎓 منصة المتميزون التعليمية</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 5px;">طلب إعادة تعيين كلمة المرور</p>
          </div>

          <div style="background-color: #ffffff; padding: 25px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
            <p style="font-size: 16px; margin: 0 0 15px 0;">مرحباً <strong>${user.name}</strong>،</p>
            <p style="font-size: 14px; line-height: 1.6; color: #334155; margin: 0 0 20px 0;">
              لقد تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك في منصة المتميزون. استخدم رمز التحقق التالي لإتمام العملية:
            </p>

            <div style="text-align: center; margin: 25px 0;">
              <div style="display: inline-block; background: linear-gradient(135deg, #0284c7, #06b6d4); color: #ffffff; font-size: 32px; font-weight: 900; letter-spacing: 8px; padding: 14px 28px; border-radius: 10px; box-shadow: 0 4px 12px rgba(6,182,212,0.3);">
                ${otp}
              </div>
            </div>

            <p style="font-size: 13px; color: #ea580c; text-align: center; font-weight: bold; margin: 0 0 15px 0;">
              ⏱️ هذا الرمز صالح لمدة 15 دقيقة فقط.
            </p>

            <p style="font-size: 12px; color: #94a3b8; line-height: 1.5; margin: 20px 0 0 0; border-top: 1px dashed #e2e8f0; padding-top: 15px;">
              إذا لم تكن أنت من طلب إعادة التعيين، يمكنك تجاهل هذه الرسالة بأمان وستظل كلمة مرورك السابقة كما هي دون تغيير.
            </p>
          </div>

          <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #94a3b8;">
            جميع الحقوق محفوظة &copy; ${new Date().getFullYear()} — منصة المتميزون التعليمية
          </div>
        </div>
      `
    };

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    try {
      await transporter.sendMail(mailOptions);
      console.log(`✉️ Password reset OTP sent to: ${user.email}`);
    } catch (mailErr) {
      console.error('❌ Gmail SMTP Error:', mailErr.message);
      console.log(`🔑 [DEV OTP FALLBACK]: رمز التحقق للمستخدم (${user.email}) هو: ${otp}`);
      if (mailErr.code === 'EAUTH') {
        return res.status(500).json({ 
          error: 'فشل إرسال البريد: كلمة مرور التطبيقات (App Password) لحساب Gmail في ملف .env غير صحيحة أو تم إيقافها من Google. يرجى تجديدها.' 
        });
      }
      throw mailErr;
    }

    res.json({ message: 'تم إرسال رمز إعادة التعيين إلى بريدك الإلكتروني بنجاح.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'حدث خطأ أثناء إرسال البريد الإلكتروني، يرجى المحاولة لاحقاً.' });
  }
});

// 🔑 Reset Password - Verify OTP and update password
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة لإعادة التعيين.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب ألا تقل عن 6 رموز.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ 
      email: cleanEmail,
      resetPasswordOtp: otp.trim(),
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ error: 'رمز التحقق غير صحيح أو انتهت صلاحيته. يرجى طلب رمز جديد.' });
    }

    // Hash new password and clear OTP
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    console.log(`✅ Password successfully reset for user: ${user.email}`);
    res.json({ message: 'تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول.' });
  } catch (err) {
    console.error('❌ Reset Password Error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إعادة تعيين كلمة المرور.' });
  }
});

// ══════════════════════════════════════════════════════
// 💳 PAYMENT GATEWAY (VISA / MASTERCARD / MADA / STRIPE)
// ══════════════════════════════════════════════════════
let stripeClient = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    const Stripe = require('stripe');
    stripeClient = Stripe(process.env.STRIPE_SECRET_KEY);
    console.log('💳 Stripe Gateway Initialized');
  } catch (err) {
    console.warn('⚠️ Stripe Init Warning:', err.message);
  }
}

// 📌 Get Payment Gateway Config
app.get('/api/payment/config', (req, res) => {
  res.json({
    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    isStripeEnabled: !!process.env.STRIPE_SECRET_KEY,
    supportedCards: ['visa', 'mastercard', 'mada', 'amex'],
    currency: 'SAR'
  });
});

// 📌 Instant Card Charge & Course Activation (Visa / Mastercard / Mada)
app.post('/api/payment/card-charge', async (req, res) => {
  try {
    const { 
      courseId, 
      studentId, 
      studentName,
      amount, 
      cardNumber, 
      cardExpiry, 
      cardCvc, 
      cardHolderName, 
      discountCode 
    } = req.body;

    if (!courseId || !studentId) {
      return res.status(400).json({ error: 'بيانات الكورس والطالب مطلوبة.' });
    }

    if (!cardNumber || !cardExpiry || !cardCvc || !cardHolderName) {
      return res.status(400).json({ error: 'يرجى إكمال جميع بيانات البطاقة البنكية (رقم البطاقة، تاريخ الانتهاء، رمز الأمان، اسم حامل البطاقة).' });
    }

    // Clean and validate card number
    const cleanCardNumber = cardNumber.toString().replace(/\s+/g, '').replace(/-/g, '');
    if (cleanCardNumber.length < 14 || cleanCardNumber.length > 19 || !/^\d+$/.test(cleanCardNumber)) {
      return res.status(400).json({ error: 'رقم البطاقة غير صحيح. يرجى إدخال رقم بطاقة فيزا أو ماستركارد أو مدى صالح.' });
    }

    // Detect card brand
    let cardBrand = 'Visa / Mastercard';
    if (/^4/.test(cleanCardNumber)) cardBrand = 'Visa';
    else if (/^5[1-5]/.test(cleanCardNumber)) cardBrand = 'Mastercard';
    else if (/^588845|^4[0-9]{5}/.test(cleanCardNumber)) cardBrand = 'Mada';

    // Find course & student
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ error: 'الكورس المطلوب غير موجود.' });
    }

    const user = await User.findById(studentId);
    if (!user) {
      return res.status(404).json({ error: 'حساب الطالب غير موجود.' });
    }

    const last4 = cleanCardNumber.slice(-4);
    const txId = 'TXN-' + Math.random().toString(36).substring(2, 9).toUpperCase() + '-' + Date.now().toString().slice(-4);
    const finalAmount = Number(amount) || Number(course.price) || 0;

    // 1. Enroll student immediately into course
    if (!course.students) course.students = [];
    const sIdStr = studentId.toString();
    if (!course.students.includes(sIdStr)) {
      course.students.push(sIdStr);
      await course.save();
    }

    // 2. Create or update EnrollmentRequest with 'approved' status
    await EnrollmentRequest.findOneAndUpdate(
      { courseId: course._id.toString(), studentId: sIdStr },
      {
        courseId: course._id.toString(),
        courseTitle: course.title,
        studentId: sIdStr,
        studentName: user.name || studentName || 'طالب المنصة',
        transferNumber: `CARD-${cardBrand}-${last4}-${txId}`,
        paymentImageUrl: 'https://cdn-icons-png.flaticon.com/512/893/893081.png',
        status: 'approved',
        discountCode: discountCode || '',
        finalPrice: finalAmount,
        originalPrice: course.price,
        message: `تم الدفع الفوري بنجاح عبر البطاقة (${cardBrand} ****${last4}) - رقم العملية: ${txId}`
      },
      { upsert: true, new: true }
    );

    console.log(`💳 [PAYMENT SUCCESS]: Student (${user.name}) paid ${finalAmount} SAR for course (${course.title}) via ${cardBrand} ****${last4} [TX: ${txId}]`);

    res.json({
      success: true,
      message: 'تمت عملية الدفع بنجاح! تم تفعيل الكورس في حسابك فوراً 🎉',
      transactionId: txId,
      cardBrand,
      last4,
      amount: finalAmount,
      courseTitle: course.title
    });
  } catch (err) {
    console.error('❌ Card Payment Error:', err);
    res.status(500).json({ error: err.message || 'حدث خطأ أثناء معالجة عملية الدفع. يرجى التحقق من بيانات البطاقة والمحاولة لاحقاً.' });
  }
});

// 📌 Create Stripe Hosted Checkout Session
app.post('/api/payment/create-checkout-session', async (req, res) => {
  try {
    const { courseId, studentId, discountCode } = req.body;
    if (!courseId || !studentId) {
      return res.status(400).json({ error: 'courseId and studentId are required' });
    }

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    const user = await User.findById(studentId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let finalPrice = Number(course.price) || 0;
    if (discountCode) {
      const disc = await DiscountCode.findOne({ code: discountCode.trim().toUpperCase() });
      if (disc && (!disc.expiresAt || new Date(disc.expiresAt) > new Date())) {
        finalPrice = Math.round(finalPrice * (1 - disc.discountPercent / 100));
      }
    }

    const domain = process.env.FRONTEND_URL || 'http://localhost:4200';

    if (stripeClient) {
      const session = await stripeClient.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'sar',
            product_data: {
              name: `كورس: ${course.title}`,
              description: course.description?.substring(0, 100) || 'منصة المتميزون التعليمية'
            },
            unit_amount: Math.max(1, finalPrice * 100) // in cents/halalas
          },
          quantity: 1
        }],
        mode: 'payment',
        customer_email: user.email || undefined,
        client_reference_id: `${studentId}_${courseId}`,
        success_url: `${domain}/courses/${courseId}?payment_success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${domain}/courses/${courseId}?payment_cancel=true`
      });

      return res.json({ url: session.url, sessionId: session.id });
    } else {
      return res.json({ 
        url: `${domain}/courses/${courseId}?payment_success=true&mock_session=true`,
        sessionId: 'MOCK_STRIPE_SESSION_' + Date.now()
      });
    }
  } catch (err) {
    console.error('❌ Stripe Session Error:', err);
    res.status(500).json({ error: err.message || 'فشل إنشاء جلسة الدفع' });
  }
});

// 🔒 Get current logged in user profile
app.get('/api/users/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      parentPhone: user.parentPhone,
      grade: user.grade,
      role: user.role
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔄 Refresh current auth token
app.get('/api/auth/refresh', authMiddleware, async (req, res) => {
  try {
    const newToken = jwt.sign(
      { id: req.user.id, role: req.user.role, name: req.user.name, grade: req.user.grade },
      JWT_SECRET,
      { expiresIn: '90d' }
    );
    res.json({ token: newToken, user: req.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 🔒 Admin only: list all users
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const users = await User.find();
    res.json(users.map(u => ({ id: u._id, ...u._doc })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: delete a user
app.delete('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: reset a user's password
app.put('/api/admin/reset-password', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'بيانات غير صالحة' });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const user = await User.findByIdAndUpdate(userId, { password: hashedPassword }, { new: true });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({ success: true, message: 'تم إعادة تعيين كلمة المرور بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Global Settings ---
app.get('/api/settings/global', async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const settings = await db.collection('settings').findOne({ _id: 'global' });
    const defaultSettings = {
      welcomeMessage: '',
      subscriptionInstructions: 'الدفع يتم يدوياً (فودافون كاش أو تحويل بنكي). بعد إتمام الدفع، يرجى كتابة اسمك وتفاصيل التحويل في الرسالة أدناه ورفع صورة إيصال الدفع ثم اضغط على "إرسال طلب اشتراك". سيقوم المدير بمراجعة طلبك وتفعيل الكورس لك فوراً.',
      supportWhatsapp: '201098744710',
      homeVideoUrl: '',
      gradeGroups: {
        'prep1': '',
        'prep2': '',
        'prep3': '',
        '1': '',
        '2': '',
        '3': '',
        'univ': ''
      },
      teacherPayments: {
        'mahmoud_arabic': {
          name: 'مستر زياد محمد حسين درويش (اللغة العربية)',
          number: '01098744710',
          message: 'الدفع لمستر زياد محمد يتم عبر فودافون كاش على رقم 01098744710. أرفق إيصال الدفع والرقم المحول منه لتأكيد الاشتراك.'
        },
        'suleiman_french': {
          name: 'أ.د/ محمود عبد الناصر درويش (المواد الأساسية والأحياء والجيولوجيا)',
          number: '01098744710',
          message: 'الدفع لأ.د/ محمود عبد الناصر درويش يتم عبر فودافون كاش على رقم المدرس. أرفق إيصال الدفع والرقم المحول منه لتأكيد الاشتراك.'
        }
      }
    };
    // Cache: الإعدادات بتتغير نادرا - نحفظها 5 دقائق في المتصفح
    res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
    if (!settings) {
      return res.json(defaultSettings);
    }
    res.json({
      ...defaultSettings,
      ...settings,
      gradeGroups: {
        ...defaultSettings.gradeGroups,
        ...(settings.gradeGroups || {})
      },
      teacherPayments: {
        ...defaultSettings.teacherPayments,
        ...(settings.teacherPayments || {})
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/settings/global', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const db = mongoose.connection.db;
    await db.collection('settings').updateOne(
      { _id: 'global' },
      { $set: req.body },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Course Routes ---
app.get('/api/courses', async (req, res) => {
  try {
    const { grade, userId } = req.query;
    let query = {};
    // Only restrict by grade if a specific non-empty grade filter is provided
    if (grade && grade !== 'all' && grade !== 'undefined' && grade.trim() !== '') {
      const orConditions = [
        { grade: grade },
        { grade: { $in: [null, '', 'all'] } },
        { grade: { $exists: false } }
      ];
      if (userId) {
        orConditions.push({ students: userId });
      }
      query = { $or: orConditions };
    }
    const courses = await Course.find(query).sort({ createdAt: -1 });
    const results = [];
    for (const course of courses) {
      const updated = await ensureCourseCoverStored(course);
      const formatted = formatCourseResponse(updated, false);
      if (userId && course.students) {
        formatted.isEnrolled = course.students.some(s => String(s).trim() === String(userId).trim());
      }
      results.push(formatted);
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Protected: Get full course lessons (video URLs) — only for enrolled students or admin
// The auth middleware here is the protection layer; iframes cannot send custom headers
// so token-redirect approaches don't work for video embeds.
app.get('/api/courses/:id/lessons', authMiddleware, async (req, res) => {
  try {
    const courseId = req.params.id;
    const requestingUserId = req.user.id;
    const requestingRole = req.user.role;

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });

    const isFree = course.price === 0 || !course.price;

    // Admins and free courses can always be accessed
    if (requestingRole !== 'admin' && !isFree) {
      const studentIds = (course.students || []).map(s => String(s).trim());
      const isEnrolled = studentIds.includes(String(requestingUserId).trim())
        || (req.user?.phone && studentIds.includes(String(req.user.phone).trim()))
        || (req.user?.email && studentIds.includes(String(req.user.email).trim().toLowerCase()));
      if (!isEnrolled) {
        return res.status(403).json({ error: 'يجب الاشتراك في الكورس أولاً للوصول إلى المحتوى' });
      }
    }

    const updated = await ensureCourseCoverStored(course);
    res.json(formatCourseResponse(updated, true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 🔒 Unified course endpoint — uses optionalAuth:
//   • Unauthenticated or not-enrolled → returns course info WITHOUT video URLs
//   • Enrolled student or admin        → returns full course WITH video URLs (saves a second /lessons call)
app.get('/api/courses/:id', optionalAuth, async (req, res) => {
  try {
    // If user provided a token that was expired (>60d) or invalid, return 401 so frontend refreshes or redirects
    if (req.tokenExpired) {
      return res.status(401).json({
        error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً لمشاهدة الفيديوهات',
        code: 'TOKEN_EXPIRED'
      });
    }

    let course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Not found' });
    course = await ensureCourseCoverStored(course);

    let includeVideos = false;
    let isEnrolled = false;
    let isAdmin = false;

    const isFree = course.price === 0 || !course.price;

    if (isFree) {
      includeVideos = true;
      isEnrolled = true;
    } else if (req.user) {
      if (req.user.role === 'admin') {
        includeVideos = true;
        isEnrolled = true;
        isAdmin = true;
      } else {
        const studentIds = (course.students || []).map(s => String(s).trim());
        isEnrolled = studentIds.includes(String(req.user.id).trim())
          || (req.user?.phone && studentIds.includes(String(req.user.phone).trim()))
          || (req.user?.email && studentIds.includes(String(req.user.email).trim().toLowerCase()));
        includeVideos = isEnrolled;
      }
    }

    const response = formatCourseResponse(course, includeVideos, isAdmin);
    response.isEnrolled = isEnrolled;
    res.json(response);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getCourseCoverUrl(doc) {
  const thumbnail = (doc.thumbnail || '').trim();
  const imageUrl = (doc.imageUrl || '').trim();
  const legacyImage = (doc.image || '').trim();
  return thumbnail || imageUrl || legacyImage;
}

function isHttpCoverUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

function fixLocalhostCoverUrl(url) {
  if (!url || !url.includes('/uploads/')) return url;
  return url.replace(/https?:\/\/localhost:\d+/i, `http://localhost:${PORT}`);
}

async function resolveCourseCoverUrl(cover) {
  if (!cover) return '';
  const trimmed = cover.trim();
  if (isHttpCoverUrl(trimmed)) return fixLocalhostCoverUrl(trimmed);
  if (trimmed.startsWith('data:image')) {
    try {
      const result = await cloudinary.uploader.upload(trimmed, { folder: 'myweb-cit' });
      return result.secure_url;
    } catch (err) {
      console.error('Failed to upload cover to Cloudinary:', err.message);
      return trimmed;
    }
  }
  return '';
}

async function ensureCourseCoverStored(course) {
  const raw = getCourseCoverUrl(course._doc || course);
  if (!raw) return course;

  if (isHttpCoverUrl(raw)) {
    const fixed = fixLocalhostCoverUrl(raw);
    if (fixed !== raw) {
      await Course.findByIdAndUpdate(course._id, { thumbnail: fixed, imageUrl: fixed });
      return Course.findById(course._id);
    }
    return course;
  }

  if (raw.startsWith('data:image')) {
    const url = await resolveCourseCoverUrl(raw);
    if (url && url !== raw) {
      await Course.findByIdAndUpdate(course._id, { thumbnail: url, imageUrl: url });
      return Course.findById(course._id);
    }
  }

  return course;
}

function formatCourseResponse(course, includeLessons = false, isAdmin = false) {
  const doc = { id: course._id, ...course._doc };
  const raw = getCourseCoverUrl(doc);
  let cover = '';
  if (isHttpCoverUrl(raw)) {
    cover = fixLocalhostCoverUrl(raw);
  } else if (raw && raw.startsWith('data:image')) {
    cover = raw;
  }
  doc.thumbnail = cover;
  doc.imageUrl = cover;

  const now = new Date();

  // 🔒 Hide lesson video URLs from public API
  if (!includeLessons) {
    if (doc.lessons && Array.isArray(doc.lessons)) {
      doc.lessons = doc.lessons.map(lesson => {
        const l = lesson.toObject ? lesson.toObject() : (lesson._doc ? { ...lesson._doc } : { ...lesson });
        const isScheduled = l.scheduledAt && new Date(l.scheduledAt) > now;
        return {
          title: l.title,
          _id: l._id,
          scheduledAt: l.scheduledAt || null,
          isScheduled
        };
      });
    }
    if (doc.units && Array.isArray(doc.units)) {
      doc.units = doc.units.map(unit => {
        const u = unit.toObject ? unit.toObject() : (unit._doc ? { ...unit._doc } : { ...unit });
        if (u.lessons && Array.isArray(u.lessons)) {
          u.lessons = u.lessons.map(lesson => {
            const l = lesson.toObject ? lesson.toObject() : (lesson._doc ? { ...lesson._doc } : { ...lesson });
            const isScheduled = l.scheduledAt && new Date(l.scheduledAt) > now;
            return {
              title: l.title,
              _id: l._id,
              scheduledAt: l.scheduledAt || null,
              isScheduled
            };
          });
        }
        return u;
      });
    }
    delete doc.url;
  } else {
    // Included lessons for enrolled student or admin
    // If NOT admin, enforce scheduledAt check and strip video URL if scheduled for future
    if (!isAdmin) {
      if (doc.lessons && Array.isArray(doc.lessons)) {
        doc.lessons = doc.lessons.map(lesson => {
          const l = lesson.toObject ? lesson.toObject() : (lesson._doc ? { ...lesson._doc } : { ...lesson });
          const isScheduled = l.scheduledAt && new Date(l.scheduledAt) > now;
          if (isScheduled) {
            delete l.url;
          }
          l.isScheduled = isScheduled;
          return l;
        });
      }
      if (doc.units && Array.isArray(doc.units)) {
        doc.units = doc.units.map(unit => {
          const u = unit.toObject ? unit.toObject() : (unit._doc ? { ...unit._doc } : { ...unit });
          if (u.lessons && Array.isArray(u.lessons)) {
            u.lessons = u.lessons.map(lesson => {
              const l = lesson.toObject ? lesson.toObject() : (lesson._doc ? { ...lesson._doc } : { ...lesson });
              const isScheduled = l.scheduledAt && new Date(l.scheduledAt) > now;
              if (isScheduled) {
                delete l.url;
              }
              l.isScheduled = isScheduled;
              return l;
            });
          }
          return u;
        });
      }
    } else {
      // Admin: attach isScheduled flag for UI visibility
      if (doc.lessons && Array.isArray(doc.lessons)) {
        doc.lessons = doc.lessons.map(lesson => {
          const l = lesson.toObject ? lesson.toObject() : (lesson._doc ? { ...lesson._doc } : { ...lesson });
          l.isScheduled = l.scheduledAt && new Date(l.scheduledAt) > now;
          return l;
        });
      }
      if (doc.units && Array.isArray(doc.units)) {
        doc.units = doc.units.map(unit => {
          const u = unit.toObject ? unit.toObject() : (unit._doc ? { ...unit._doc } : { ...unit });
          if (u.lessons && Array.isArray(u.lessons)) {
            u.lessons = u.lessons.map(lesson => {
              const l = lesson.toObject ? lesson.toObject() : (lesson._doc ? { ...lesson._doc } : { ...lesson });
              l.isScheduled = l.scheduledAt && new Date(l.scheduledAt) > now;
              return l;
            });
          }
          return u;
        });
      }
    }
  }

  return doc;
}

async function normalizeCoursePayload(body) {
  const data = { ...body };
  const cover = await resolveCourseCoverUrl(getCourseCoverUrl(data));
  if (cover) {
    data.thumbnail = cover;
    data.imageUrl = cover;
  } else {
    delete data.thumbnail;
    delete data.imageUrl;
  }
  delete data.image;

  const parseScheduledAt = (val) => {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  // Format scheduledAt for lessons
  if (data.lessons && Array.isArray(data.lessons)) {
    data.lessons = data.lessons.map(l => ({
      ...l,
      scheduledAt: parseScheduledAt(l.scheduledAt)
    }));
  }
  if (data.units && Array.isArray(data.units)) {
    data.units = data.units.map(u => ({
      ...u,
      lessons: Array.isArray(u.lessons) ? u.lessons.map(l => ({
        ...l,
        scheduledAt: parseScheduledAt(l.scheduledAt)
      })) : []
    }));
  }

  return data;
}

// 🔒 Admin only: create course
app.post('/api/courses', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const course = new Course(await normalizeCoursePayload(req.body));
    await course.save();
    res.json(formatCourseResponse(course, true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: update course
app.put('/api/courses/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const existing = await Course.findById(req.params.id);
    const payload = await normalizeCoursePayload(req.body);

    if (existing) {
      // 🛡️ Safety: Preserve existing video URLs if incoming payload has an empty url for a lesson
      if (payload.units && Array.isArray(payload.units)) {
        payload.units = payload.units.map((unit, ui) => {
          const oldUnit = existing.units && existing.units[ui];
          if (unit.lessons && Array.isArray(unit.lessons)) {
            unit.lessons = unit.lessons.map((lesson, li) => {
              const oldLesson = oldUnit && oldUnit.lessons && oldUnit.lessons[li];
              if ((!lesson.url || !lesson.url.trim()) && oldLesson && oldLesson.url) {
                lesson.url = oldLesson.url;
              }
              return lesson;
            });
          }
          return unit;
        });
      }

      if (payload.lessons && Array.isArray(payload.lessons)) {
        payload.lessons = payload.lessons.map((lesson, li) => {
          const oldLesson = existing.lessons && existing.lessons[li];
          if ((!lesson.url || !lesson.url.trim()) && oldLesson && oldLesson.url) {
            lesson.url = oldLesson.url;
          }
          return lesson;
        });
      }
    }

    const course = await Course.findByIdAndUpdate(req.params.id, payload, { new: true });
    res.json(formatCourseResponse(course, true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: delete course
app.delete('/api/courses/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    await Course.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Books ---
// 🔒 Admin only: Add Book
app.post('/api/books', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { title, description, price, imageUrl, instructorName, subject, importance } = req.body;
    if (!title || !price || !instructorName || !subject) {
      return res.status(400).json({ error: 'يرجى ملء جميع الحقول المطلوبة' });
    }
    const book = new Book({ title, description, price, imageUrl, instructorName, subject, importance: importance || 'normal' });
    await book.save();
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public: Get all books
app.get('/api/books', async (req, res) => {
  try {
    const books = await Book.find().sort({ createdAt: -1 });
    const docs = books.map(book => {
      const obj = book.toObject();
      return {
        ...obj,
        id: obj._id ? obj._id.toString() : '',
        importance: obj.importance || 'normal',
        imageUrl: fixUploadUrl(obj.imageUrl, req)
      };
    });

    // Sort essential ("ضروري") books to the top!
    docs.sort((a, b) => {
      const aIsEssential = a.importance === 'essential' || a.importance === 'ضروري';
      const bIsEssential = b.importance === 'essential' || b.importance === 'ضروري';
      if (aIsEssential && !bIsEssential) return -1;
      if (!aIsEssential && bIsEssential) return 1;
      return 0;
    });

    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: Update book
app.put('/api/books/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { title, description, price, imageUrl, instructorName, subject, importance } = req.body;
    const book = await Book.findByIdAndUpdate(
      req.params.id,
      { title, description, price, imageUrl, instructorName, subject, importance: importance || 'normal' },
      { new: true }
    );
    if (!book) return res.status(404).json({ error: 'الكتاب غير موجود' });
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: Quick update book importance (supports both PUT and PATCH)
const updateBookImportanceHandler = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { importance } = req.body;
    const book = await Book.findByIdAndUpdate(
      req.params.id,
      { importance: importance || 'normal' },
      { new: true }
    );
    if (!book) return res.status(404).json({ error: 'الكتاب غير موجود' });
    res.json(book);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

app.put('/api/books/:id/importance', authMiddleware, updateBookImportanceHandler);
app.patch('/api/books/:id/importance', authMiddleware, updateBookImportanceHandler);

// 🔒 Admin only: Delete book
app.delete('/api/books/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    await Book.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Book Orders ---
// Public/Student: Submit a book order
app.post('/api/book-orders', async (req, res) => {
  try {
    const { bookId, bookTitle, price, studentName, studentPhone, deliveryLocation, transferNumber, paymentImageUrl, subject } = req.body;
    if (!bookId || !bookTitle || !price || !studentName || !studentPhone || !deliveryLocation || !transferNumber || !paymentImageUrl || !subject) {
      return res.status(400).json({ error: 'يرجى إدخال جميع البيانات المطلوبة لطلب الكتاب' });
    }
    const order = new BookOrder({
      bookId, bookTitle, price, studentName, studentPhone, deliveryLocation, transferNumber, paymentImageUrl, subject
    });
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: Get all book orders
app.get('/api/book-orders', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const orders = await BookOrder.find().sort({ createdAt: -1 });
    const formattedOrders = orders.map(order => ({
      ...order.toObject(),
      paymentImageUrl: fixUploadUrl(order.paymentImageUrl, req)
    }));
    res.json(formattedOrders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: Update order status
app.put('/api/book-orders/:id/status', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة' });
    }
    const order = await BookOrder.findByIdAndUpdate(req.params.id, { status }, { new: true });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Enrollment Requests ---
app.post('/api/enrollments', authMiddleware, async (req, res) => {
  try {
    if (!req.body.transferNumber || !req.body.transferNumber.trim()) {
      return res.status(400).json({ error: 'يجب كتابة رقم التحويل' });
    }
    if (!req.body.paymentImageUrl || !req.body.paymentImageUrl.trim()) {
      return res.status(400).json({ error: 'يجب رفع صورة إيصال الدفع' });
    }

    // Prevent duplicate pending requests for the same course
    const duplicate = await EnrollmentRequest.findOne({
      studentId: req.user.id,
      courseId: req.body.courseId,
      status: 'pending'
    });
    if (duplicate) {
      return res.status(400).json({ error: 'لديك طلب اشتراك معلق لهذا الكورس بالفعل، انتظر موافقة المدير' });
    }

    let discountInfo = {};
    if (req.body.discountCode) {
      const codeUpper = req.body.discountCode.toUpperCase().trim();
      const discount = await DiscountCode.findOne({ code: codeUpper, isActive: true });
      if (!discount) {
        return res.status(400).json({ error: 'كود الخصم غير صالح أو معطل' });
      }
      if (discount.expiresAt && new Date() > new Date(discount.expiresAt)) {
        return res.status(400).json({ error: 'كود الخصم منتهي الصلاحية' });
      }
      if (discount.maxUses > 0 && discount.usedCount >= discount.maxUses) {
        return res.status(400).json({ error: 'تم استخدام كود الخصم بالكامل' });
      }
      const originalPrice = req.body.originalPrice || 0;
      const discountAmount = Math.round((originalPrice * discount.discountPercent) / 100);
      const finalPrice = Math.max(0, originalPrice - discountAmount);

      discountInfo = {
        discountCode: discount.code,
        discountPercent: discount.discountPercent,
        originalPrice,
        finalPrice
      };
    }

    const reqData = new EnrollmentRequest({
      ...req.body,
      ...discountInfo,
      studentId: req.user.id,
      studentName: req.user.name,
      status: 'pending', // force pending to prevent client-side auto-approvals
      message: (req.body.message || '').trim(),
      transferNumber: req.body.transferNumber.trim(),
      paymentImageUrl: (req.body.paymentImageUrl || '').trim()
    });
    await reqData.save();
    res.json(formatEnrollmentRequest(reqData, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: list enrollment requests
app.get('/api/enrollments', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const reqs = await EnrollmentRequest.find().sort({ createdAt: -1 });
    res.json(reqs.map(r => formatEnrollmentRequest(r, req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: delete enrollment request
app.delete('/api/enrollments/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    await EnrollmentRequest.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: approve enrollment
app.put('/api/courses/:id/enroll', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { studentId, requestId } = req.body;
    if (requestId) {
      const enrollmentReq = await EnrollmentRequest.findById(requestId);
      if (enrollmentReq && enrollmentReq.discountCode) {
        await DiscountCode.findOneAndUpdate(
          { code: enrollmentReq.discountCode },
          { $inc: { usedCount: 1 } }
        );
      }
      await EnrollmentRequest.findByIdAndDelete(requestId);
    }
    const course = await Course.findByIdAndUpdate(req.params.id, { $addToSet: { students: studentId } }, { new: true });
    res.json(formatCourseResponse(course, true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔒 Admin only: unenroll / remove student from course
app.put('/api/courses/:id/unenroll', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId مطلوب' });

    const course = await Course.findByIdAndUpdate(
      req.params.id,
      { $pull: { students: studentId } },
      { new: true }
    );
    if (!course) return res.status(404).json({ error: 'الكورس غير موجود' });
    res.json(formatCourseResponse(course, true));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/enrollments/status/:courseId/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.params.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const reqData = await EnrollmentRequest.findOne({ courseId: req.params.courseId, studentId: req.params.userId });
    res.json(reqData ? formatEnrollmentRequest(reqData, req) : null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { identifier } = req.body;
  
  // Prevent NoSQL Injection by validating input types
  if (typeof identifier !== 'string') {
    return res.status(400).json({ error: 'البيانات المرسلة غير صالحة' });
  }
  
  try {
    const user = await User.findOne({ 
      $or: [{ email: identifier }, { phone: identifier }] 
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.email) {
      return res.status(400).json({ error: 'عذراً، هذا الحساب لا يحتوي على بريد إلكتروني مسجل لإرسال رابط إعادة التعيين.' });
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Password Reset - Edu_DB',
      text: `Hello ${user.name},\n\nYou requested a password reset. For now, this is a confirmation that your email is recognized. In a full implementation, you would receive a secure link here.\n\nThank you!`
    };

    await transporter.sendMail(mailOptions);
    res.json({ message: 'Reset email sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Reviews ---
app.post('/api/reviews', authMiddleware, async (req, res) => {
  try {
    const reviewData = {
      ...req.body,
      userId: req.user.id,
      userName: req.user.name
    };
    const review = new Review(reviewData);
    await review.save();
    res.json({ id: review._id, ...review._doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Tasks ---
app.get('/api/tasks/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.params.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const tasks = await Task.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(tasks.map(t => ({ id: t._id, ...t._doc })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', authMiddleware, async (req, res) => {
  try {
    const taskData = {
      ...req.body,
      userId: req.user.id
    };
    const task = new Task(taskData);
    await task.save();
    res.json({ id: task._id, ...task._doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (task.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const updated = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ id: updated._id, ...updated._doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', authMiddleware, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'المهمة غير موجودة' });
    if (task.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    await Task.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Sessions ---
app.post('/api/sessions', authMiddleware, async (req, res) => {
  try {
    const sessionData = {
      ...req.body,
      userId: req.user.id
    };
    const session = new Session(sessionData);
    await session.save();
    res.json({ id: session._id, ...session._doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sessions/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.params.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const sessions = await Session.find({ userId: req.params.userId });
    res.json(sessions.map(s => ({ id: s._id, ...s._doc })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Quizzes ---
app.post('/api/quizzes', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const quiz = new Quiz(req.body);
    await quiz.save();
    res.json({ id: quiz._id, ...quiz._doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/quizzes', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const quizzes = await Quiz.find().sort({ createdAt: -1 });
    res.json(quizzes.map(q => ({ id: q._id, ...q._doc })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/quizzes/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const quiz = await Quiz.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!quiz) return res.status(404).json({ error: 'الاختبار غير موجود' });
    res.json({ id: quiz._id, ...quiz._doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/quizzes/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const quiz = await Quiz.findByIdAndDelete(req.params.id);
    if (!quiz) return res.status(404).json({ error: 'الاختبار غير موجود' });
    res.json({ message: 'تم حذف الاختبار بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/quizzes/course/:courseId', async (req, res) => {
  try {
    const quizzes = await Quiz.find({ courseId: req.params.courseId });
    res.json(quizzes.map(q => ({ id: q._id, ...q._doc })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/submissions', authMiddleware, async (req, res) => {
  try {
    const data = req.body;
    console.log('📥 Incoming Submission:', data);

    // Force current authenticated user ID
    data.userId = String(req.user.id);
    const user = await User.findById(req.user.id);
    if (user) {
      data.studentName = user.name;
      data.studentEmail = user.email;
    }

    if (data.quizId) {
      data.quizId = String(data.quizId);
      const quiz = await Quiz.findById(data.quizId);
      if (quiz) {
        data.quizTitle = quiz.title;
        if (!data.courseId && quiz.courseId) {
          data.courseId = String(quiz.courseId);
        }
      }
    }
    if (data.courseId) {
      data.courseId = String(data.courseId);
    }

    const sub = new Submission(data);
    await sub.save();
    console.log('✅ Submission Saved Successfully:', sub._id);
    res.json({ id: sub._id, ...sub._doc });
  } catch (err) {
    console.error('❌ Submission Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/submissions', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const subs = await Submission.find().sort({ createdAt: -1 });
    res.json(subs.map(s => ({ 
      id: s._id, 
      ...s._doc,
      submittedAt: s.createdAt // Ensure date is passed
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Chat ---
app.get('/api/messages/:courseId', async (req, res) => {
  try {
    const msgs = await Message.find({ courseId: req.params.courseId }).sort({ createdAt: 1 });
    res.json(msgs.map(m => ({ id: m._id, ...m._doc })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', authMiddleware, async (req, res) => {
  try {
    const msgData = {
      ...req.body,
      userId: req.user.id,
      userName: req.user.name
    };
    const msg = new Message(msgData);
    await msg.save();
    res.json({ id: msg._id, ...msg._doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/certificates', authMiddleware, async (req, res) => {
  try {
    const { userId, courseId } = req.body;
    if (!userId || !courseId) {
      return res.status(400).json({ error: 'userId and courseId are required' });
    }

    if (userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }

    // Verify progress
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    if (!course.certificatesEnabled) {
      return res.status(400).json({ error: 'عذراً، لم يتم إتاحة إصدار الشهادات لهذا الكورس من قبل الإدارة بعد' });
    }

    let lessonsCount = 0;
    if (course.units && course.units.length > 0) {
      lessonsCount = course.units.reduce((sum, u) => sum + (u.lessons?.length || 0), 0);
    } else if (course.lessons && course.lessons.length > 0) {
      lessonsCount = course.lessons.length;
    }
    const completedProgress = await LessonProgress.find({
      userId,
      courseId,
      $or: [
        { completed: { $ne: false } },
        { pointsAwarded: { $gt: 0 } }
      ]
    });
    const totalWatchedCount = completedProgress.length;
    const allVideosWatched = lessonsCount === 0 || totalWatchedCount >= lessonsCount;

    const quizzes = await Quiz.find({ courseId });
    const submissions = await Submission.find({ userId, courseId });

    let allQuizzesPassed = true;
    for (const quiz of quizzes) {
      const quizSubs = submissions.filter(s => s.quizId?.toString() === quiz._id.toString());
      const maxScore = quizSubs.length > 0 ? Math.max(...quizSubs.map(s => s.score || 0)) : 0;
      if (maxScore < 70) {
        allQuizzesPassed = false;
        break;
      }
    }

    if (!allVideosWatched || !allQuizzesPassed) {
      return res.status(400).json({ error: 'عذراً، يجب عليك مشاهدة كافة الدروس واجتياز كل الاختبارات بنسبة 70% أو أكثر أولاً' });
    }

    const db = mongoose.connection.db;
    // Check if certificate already exists to avoid duplicates
    const existingCert = await db.collection('certificates').findOne({ userId, courseId });
    if (existingCert) {
      return res.json({ success: true, id: existingCert._id, message: 'الشهادة مصدرة بالفعل' });
    }

    // Build a sanitized certificate document to prevent database pollution and stored XSS
    const certDoc = {
      userId,
      courseId,
      courseTitle: req.body.courseTitle || course.title,
      studentName: req.body.studentName || req.user.name,
      date: req.body.date ? new Date(req.body.date) : new Date(),
      createdAt: new Date()
    };

    const result = await db.collection('certificates').insertOne(certDoc);
    res.json({ success: true, id: result.insertedId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/certificates/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.params.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    const db = mongoose.connection.db;
    const certs = await db.collection('certificates').find({ userId: req.params.userId }).toArray();
    res.json(certs.map(c => ({ id: c._id, ...c })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student Stats API
app.get('/api/student/stats/:userId', authMiddleware, async (req, res) => {
  try {
    const userId = req.params.userId;
    if (userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح' });
    }
    
    // 1. Joined Courses
    const joinedCoursesCount = await Course.countDocuments({ students: userId });
    
    // 2. Completed Courses (Assuming 70%+ score in at least one quiz for the course counts as completion)
    // In a real app, this would be more complex (tracking all lessons)
    const completions = await Submission.find({ userId, score: { $gte: 70 } }).distinct('courseId');
    const completedCoursesCount = completions.length;
    
    // 3. Saved Videos (Assuming a placeholder for now as we haven't implemented video saving yet)
    const savedVideosCount = 0; 
    
    // 4. Weekly Activity (Sessions in the last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sessions = await Session.find({ 
      userId, 
      createdAt: { $gte: sevenDaysAgo } 
    });
    
    // Format sessions into days (Saturday to Friday)
    const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const activity = days.map(day => ({ name: day, value: 0 }));
    
    sessions.forEach(s => {
      const dayIndex = new Date(s.createdAt).getDay();
      // Map JS getDay() (0=Sun) to our Arabic days array
      activity[dayIndex].value += s.duration;
    });

    // 5. Total Progress Percentage (Mock logic: (completed / total) * 100)
    const progress = joinedCoursesCount > 0 ? Math.round((completedCoursesCount / joinedCoursesCount) * 100) : 0;

    res.json({
      joinedCourses: joinedCoursesCount,
      completedCourses: completedCoursesCount,
      savedVideos: savedVideosCount,
      progress: progress,
      activity: activity
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STREAK & BADGES APIs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BADGES = [
  { id: 'first_login',   label: '🎉 أول تسجيل دخول',   condition: (u) => true },
  { id: 'streak_3',     label: '🔥 3 أيام متواصلة',    condition: (u) => u.streak >= 3 },
  { id: 'streak_7',     label: '⚡ أسبوع متواصل',       condition: (u) => u.streak >= 7 },
  { id: 'streak_30',    label: '🏆 شهر متواصل',         condition: (u) => u.streak >= 30 },
  { id: 'max_streak_7', label: '🌟 أعلى streak 7 أيام', condition: (u) => u.maxStreak >= 7 },
];

// POST /api/streak/update — يُستدعى عند تسجيل الدخول أو فتح الداشبورد
app.post('/api/streak/update', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastActive = user.lastActiveDate ? new Date(user.lastActiveDate) : null;
    const lastActiveDay = lastActive
      ? new Date(lastActive.getFullYear(), lastActive.getMonth(), lastActive.getDate())
      : null;

    let newStreak = user.streak || 0;
    let newBadges = [...(user.badges || [])];
    const earnedNewBadge = [];

    if (!lastActiveDay) {
      // أول مرة يسجل دخول
      newStreak = 1;
    } else {
      const diffDays = Math.round((today - lastActiveDay) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) {
        // نفس اليوم — لا تغيير
      } else if (diffDays === 1) {
        // اليوم التالي — زيادة streak
        newStreak += 1;
      } else {
        // انقطع — إعادة تعيين
        newStreak = 1;
      }
    }

    const newMaxStreak = Math.max(user.maxStreak || 0, newStreak);

    // حساب الشارات
    const tempUser = { streak: newStreak, maxStreak: newMaxStreak };
    for (const badge of BADGES) {
      if (!newBadges.includes(badge.id) && badge.condition(tempUser)) {
        newBadges.push(badge.id);
        earnedNewBadge.push(badge);
      }
    }

    await User.findByIdAndUpdate(req.user.id, {
      streak: newStreak,
      maxStreak: newMaxStreak,
      lastActiveDate: now,
      badges: newBadges,
    });

    // Return full badge details (not just IDs) so the client doesn't need a separate GET /streak call
    const badgeDetails = BADGES.filter(b => newBadges.includes(b.id)).map(b => ({ id: b.id, label: b.label }));
    res.json({
      streak: newStreak,
      maxStreak: newMaxStreak,
      badges: badgeDetails,
      newBadges: earnedNewBadge,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/streak — جلب بيانات الـ streak الحالي
app.get('/api/streak', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('streak maxStreak badges lastActiveDate');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const badgeDetails = BADGES.filter(b => (user.badges || []).includes(b.id)).map(b => ({ id: b.id, label: b.label }));
    res.json({
      streak: user.streak || 0,
      maxStreak: user.maxStreak || 0,
      badges: badgeDetails,
      lastActiveDate: user.lastActiveDate,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BOOKMARKS APIs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/bookmarks — جلب كل bookmarks الطالب
app.get('/api/bookmarks', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('bookmarks');
    res.json(user?.bookmarks || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bookmarks — إضافة أو حذف bookmark (toggle)
app.post('/api/bookmarks', authMiddleware, async (req, res) => {
  try {
    const { courseId, courseTitle, lessonIndex, lessonTitle, unitTitle } = req.body;
    const user = await User.findById(req.user.id).select('bookmarks');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bookmarks = user.bookmarks || [];
    const existingIdx = bookmarks.findIndex(
      b => b.courseId === courseId && b.lessonIndex === lessonIndex
    );

    let action;
    if (existingIdx > -1) {
      // إزالة
      bookmarks.splice(existingIdx, 1);
      action = 'removed';
    } else {
      // إضافة
      bookmarks.push({ courseId, courseTitle, lessonIndex, lessonTitle, unitTitle, savedAt: new Date() });
      action = 'added';
    }

    await User.findByIdAndUpdate(req.user.id, { bookmarks });
    res.json({ action, bookmarks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// NOTES APIs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/notes/:courseId — جلب ملاحظات الطالب في كورس معين
app.get('/api/notes/:courseId', authMiddleware, async (req, res) => {
  try {
    const notes = await Note.find({ userId: req.user.id, courseId: req.params.courseId });
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notes — حفظ أو تحديث ملاحظة (upsert)
app.post('/api/notes', authMiddleware, async (req, res) => {
  try {
    const { courseId, lessonIndex, lessonTitle, text } = req.body;
    const note = await Note.findOneAndUpdate(
      { userId: req.user.id, courseId, lessonIndex },
      { text, lessonTitle, userId: req.user.id, courseId, lessonIndex },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(note);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id — حذف ملاحظة
app.delete('/api/notes/:id', authMiddleware, async (req, res) => {
  try {
    await Note.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DISCOUNT CODES APIs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/admin/discount-codes — جلب كل الأكواد (admin only)
app.get('/api/admin/discount-codes', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const codes = await DiscountCode.find().sort({ createdAt: -1 });
    res.json(codes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/discount-codes — إنشاء كود جديد (admin only)
app.post('/api/admin/discount-codes', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const { code, discountPercent, maxUses, expiresAt, description } = req.body;
    const existing = await DiscountCode.findOne({ code: code.toUpperCase() });
    if (existing) return res.status(400).json({ error: 'الكود موجود بالفعل' });

    const newCode = await DiscountCode.create({
      code: code.toUpperCase().trim(),
      discountPercent,
      maxUses: maxUses || 0,
      expiresAt: expiresAt || null,
      description: description || '',
    });
    res.json(newCode);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/discount-codes/:id — حذف كود (admin only)
app.delete('/api/admin/discount-codes/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    await DiscountCode.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/discount-codes/:id/toggle — تفعيل/تعطيل كود
app.patch('/api/admin/discount-codes/:id/toggle', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'غير مصرح' });
    const code = await DiscountCode.findById(req.params.id);
    if (!code) return res.status(404).json({ error: 'الكود غير موجود' });
    code.isActive = !code.isActive;
    await code.save();
    res.json(code);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/discount-codes/validate — التحقق من كود عند الاشتراك
app.post('/api/discount-codes/validate', async (req, res) => {
  try {
    const { code, price } = req.body;
    if (!code) return res.status(400).json({ error: 'أدخل الكود' });

    const discount = await DiscountCode.findOne({ code: code.toUpperCase(), isActive: true });
    if (!discount) return res.status(404).json({ error: 'الكود غير صالح أو منتهي' });

    // التحقق من الانتهاء
    if (discount.expiresAt && new Date() > new Date(discount.expiresAt)) {
      return res.status(400).json({ error: 'الكود منتهي الصلاحية' });
    }

    // التحقق من الحد الأقصى للاستخدام
    if (discount.maxUses > 0 && discount.usedCount >= discount.maxUses) {
      return res.status(400).json({ error: 'تم استخدام الكود بالكامل' });
    }

    const originalPrice = price || 0;
    const discountAmount = Math.round((originalPrice * discount.discountPercent) / 100);
    const finalPrice = Math.max(0, originalPrice - discountAmount);

    res.json({
      valid: true,
      discountPercent: discount.discountPercent,
      discountAmount,
      finalPrice,
      code: discount.code,
      description: discount.description,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════
//  🔑 KEY ROTATION SYSTEM - تبديل تلقائي بين المفاتيح
// ══════════════════════════════════════════════════════════════════

const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY_2,
].filter(k => k && k.trim() !== ''); // فلترة المفاتيح الفارغة

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// حالة المفاتيح - يحفظ أي مفتاح وصل لحده
const keyStatus = {
  currentIndex: 0,
  exhaustedKeys: new Set(),
  lastReset: new Date().toDateString(), // يُعاد تعيينه كل يوم

  // احصل على المفتاح النشط الحالي
  getActiveKey() {
    const today = new Date().toDateString();
    // إعادة تعيين جميع المفاتيح كل يوم جديد (Groq يجدد الحد يومياً)
    if (today !== this.lastReset) {
      this.exhaustedKeys.clear();
      this.currentIndex = 0;
      this.lastReset = today;
      console.log('🔄 تم تجديد حدود API - يوم جديد');
    }

    // ابحث عن مفتاح غير مستنفد
    for (let i = 0; i < GROQ_KEYS.length; i++) {
      const idx = (this.currentIndex + i) % GROQ_KEYS.length;
      if (!this.exhaustedKeys.has(idx)) {
        this.currentIndex = idx;
        return { key: GROQ_KEYS[idx], index: idx };
      }
    }
    return null; // كل المفاتيح استُنفدت
  },

  // ضع علامة على مفتاح أنه وصل للحد
  markExhausted(index) {
    this.exhaustedKeys.add(index);
    console.log(`⚠️ المفتاح ${index + 1} وصل لحده اليومي - التبديل للمفتاح التالي`);
    // انتقل للمفتاح التالي
    this.currentIndex = (index + 1) % GROQ_KEYS.length;
  },

  // كم مفتاح متبقي
  get availableCount() {
    return GROQ_KEYS.length - this.exhaustedKeys.size;
  }
};

// Helper: استدعاء Groq مع Key Rotation تلقائي
async function callGroq(messages, maxTokens = 1024) {
  const https = require('https');

  if (GROQ_KEYS.length === 0) {
    throw new Error('لم يتم تعيين أي مفتاح Groq API');
  }

  // حاول مع كل المفاتيح المتاحة
  for (let attempt = 0; attempt < GROQ_KEYS.length; attempt++) {
    const activeKey = keyStatus.getActiveKey();

    if (!activeKey) {
      throw new Error('عذراً، تم استنفاد حد الذكاء الاصطناعي لهذا اليوم. يُجدَّد غداً تلقائياً 🌅');
    }

    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    });

    try {
      const result = await new Promise((resolve, reject) => {
        const url = new URL(GROQ_API_URL);
        const options = {
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${activeKey.key}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);

              // 429 = وصل للحد → جرّب المفتاح التالي
              if (res.statusCode === 429 || (parsed.error && parsed.error.code === 'rate_limit_exceeded')) {
                return reject({ isRateLimit: true, keyIndex: activeKey.index });
              }

              if (parsed.error) return reject(new Error(parsed.error.message));
              resolve(parsed.choices[0].message.content.trim());
            } catch (e) {
              reject(new Error('فشل في تحليل رد الذكاء الاصطناعي'));
            }
          });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
      });

      // ✅ نجح الطلب
      console.log(`✅ AI طلب ناجح - المفتاح ${activeKey.index + 1}`);
      return result;

    } catch (err) {
      // إذا كان 429 → ضع علامة على المفتاح واجرّب التالي
      if (err.isRateLimit) {
        keyStatus.markExhausted(err.keyIndex);
        console.log(`🔄 التبديل للمفتاح التالي... المتاح: ${keyStatus.availableCount}`);
        continue; // جرّب مرة أخرى مع المفتاح التالي
      }
      // خطأ عادي → ارفعه
      throw err;
    }
  }

  throw new Error('عذراً، تم استنفاد حد الذكاء الاصطناعي لهذا اليوم. يُجدَّد غداً تلقائياً 🌅');
}

// Endpoint: حالة المفاتيح (للمراقبة)
app.get('/api/ai/status', authMiddleware, (req, res) => {
  res.json({
    totalKeys: GROQ_KEYS.length,
    availableKeys: keyStatus.availableCount,
    exhaustedKeys: keyStatus.exhaustedKeys.size,
    resetsAt: 'كل يوم تلقائياً',
    status: keyStatus.availableCount > 0 ? '✅ يعمل' : '❌ استُنفد لهذا اليوم'
  });
});


// ── 1. تلخيص النص ──────────────────────────────────────────────
app.post('/api/ai/summarize', authMiddleware, async (req, res) => {
  try {
    const { text, language = 'ar' } = req.body;
    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: 'الرجاء إدخال نص كافٍ للتلخيص (20 حرف على الأقل)' });
    }

    const messages = [
      {
        role: 'system',
        content: `أنت مساعد تعليمي متخصص. مهمتك تلخيص المحتوى الدراسي بطريقة واضحة ومنظمة.
قم بتلخيص النص مع:
- استخراج أهم النقاط
- تنظيمها في نقاط واضحة
- استخدام لغة بسيطة مناسبة للطلاب
- الرد باللغة العربية دائماً`
      },
      {
        role: 'user',
        content: `لخص النص التالي:\n\n${text}`
      }
    ];

    const summary = await callGroq(messages, 800);
    res.json({ success: true, summary });
  } catch (err) {
    console.error('AI Summarize Error:', err.message);
    res.status(500).json({ error: 'حدث خطأ في التلخيص. حاول مرة أخرى.' });
  }
});

// ── 2. الدردشة / الإجابة على الأسئلة ───────────────────────────
app.post('/api/ai/chat', authMiddleware, async (req, res) => {
  try {
    const { question, history = [] } = req.body;
    if (!question || question.trim().length < 3) {
      return res.status(400).json({ error: 'الرجاء كتابة سؤالك' });
    }

    const systemMessage = {
      role: 'system',
      content: `أنت مساعد تعليمي ذكي ومتخصص في التعليم العربي.
مهمتك مساعدة الطلاب في:
- الإجابة على أسئلتهم الدراسية بوضوح
- شرح المفاهيم الصعبة بطريقة بسيطة
- تقديم أمثلة توضيحية
- تشجيع الطلاب على التعلم

قواعد مهمة:
- تحدث دائماً باللغة العربية
- كن صبوراً ومشجعاً
- إذا السؤال خارج نطاق التعليم، وجّه الطالب بلطف
- استخدم المصطلحات العلمية الصحيحة مع شرحها`
    };

    const messages = [
      systemMessage,
      ...history.slice(-6),
      { role: 'user', content: question }
    ];

    const answer = await callGroq(messages, 500);
    res.json({ success: true, answer });
  } catch (err) {
    console.error('AI Chat Error:', err.message);
    res.status(500).json({ error: 'حدث خطأ في الإجابة. حاول مرة أخرى.' });
  }
});

// ── 3. إنشاء اختبار إلكتروني ────────────────────────────────────
app.post('/api/ai/generate-quiz', authMiddleware, async (req, res) => {
  try {
    const { topic, numberOfQuestions = 5, difficulty = 'medium', grade = '' } = req.body;
    if (!topic || topic.trim().length < 3) {
      return res.status(400).json({ error: 'الرجاء إدخال موضوع الاختبار' });
    }

    const difficultyMap = { easy: 'سهل', medium: 'متوسط', hard: 'صعب' };
    const difficultyAr = difficultyMap[difficulty] || 'متوسط';

    const messages = [
      {
        role: 'system',
        content: `أنت مساعد تعليمي متخصص في إنشاء الاختبارات التعليمية.
يجب أن تُرجع الاختبار بصيغة JSON صحيحة فقط بدون أي نص إضافي.
الصيغة المطلوبة:
{
  "title": "عنوان الاختبار",
  "questions": [
    {
      "id": 1,
      "question": "نص السؤال",
      "options": ["الخيار أ", "الخيار ب", "الخيار ج", "الخيار د"],
      "correctIndex": 0,
      "explanation": "شرح الإجابة الصحيحة"
    }
  ]
}
مهم: أرجع JSON فقط بدون أي نص قبله أو بعده.`
      },
      {
        role: 'user',
        content: `أنشئ اختباراً تعليمياً عن موضوع: "${topic}"
عدد الأسئلة: ${numberOfQuestions}
مستوى الصعوبة: ${difficultyAr}
${grade ? `المرحلة الدراسية: ${grade}` : ''}
الأسئلة يجب أن تكون من نوع اختيار من متعدد (4 خيارات).
باللغة العربية.`
      }
    ];

    const raw = await callGroq(messages, 1500);

    // Extract JSON from response
    let quizData;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('لم يتم إنشاء JSON صحيح');
      quizData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(500).json({ error: 'فشل في إنشاء الاختبار. حاول مرة أخرى.' });
    }

    res.json({ success: true, quiz: quizData });
  } catch (err) {
    console.error('AI Quiz Error:', err.message);
    res.status(500).json({ error: 'حدث خطأ في إنشاء الاختبار. حاول مرة أخرى.' });
  }
});

// ──────────────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════
//  🎬 CLOUDINARY VIDEO PROTECTION SYSTEM (مجاني 100%)
//  ✅ Signed URLs تنتهي صلاحيتها
//  ✅ Watermark مدمج في بكسلات الفيديو
//  ✅ لا يمكن تحميله بـ yt-dlp أو IDM
//  ✅ كل رابط مرتبط بهوية الطالب
// ══════════════════════════════════════════════════════════════════

/**
 * يولّد رابط Cloudinary محمي بـ:
 * 1. Signed URL تنتهي بعد مدة محددة
 * 2. Watermark اسم الطالب مدمج في الفيديو
 * 3. منع التحميل المباشر
 */
function generateProtectedVideoUrl(publicId, studentName, studentId, expiresInSeconds = 7200) {
  const expireAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  // تنظيف الاسم للاستخدام في URL
  const safeName = (studentName || 'طالب').replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').trim();
  const safeId = (studentId || '').slice(-6).toUpperCase();
  const timestamp = new Date().toLocaleDateString('ar-EG');

  // Cloudinary Transformation: watermark نصي مدمج في الفيديو
  const transformation = [
    // Watermark في الزاوية العلوية اليمنى
    {
      overlay: {
        font_family: 'Cairo',
        font_size: 22,
        font_weight: 'bold',
        text: `${safeName} | ID:${safeId}`
      },
      color: 'white',
      opacity: 40,
      gravity: 'north_east',
      x: 20,
      y: 20
    },
    // Watermark التاريخ في الزاوية السفلية اليسرى
    {
      overlay: {
        font_family: 'Cairo',
        font_size: 16,
        text: `محتوى محمي - ${timestamp}`
      },
      color: 'white',
      opacity: 30,
      gravity: 'south_west',
      x: 20,
      y: 20
    },
    // Watermark وسط الشاشة بشفافية عالية
    {
      overlay: {
        font_family: 'Cairo',
        font_size: 38,
        font_weight: 'bold',
        text: safeName
      },
      color: 'white',
      opacity: 12,
      gravity: 'center',
      angle: -30
    }
  ];

  // إنشاء Signed URL
  const signedUrl = cloudinary.url(publicId, {
    resource_type: 'video',
    type: 'upload',
    sign_url: true,
    expires_at: expireAt,
    transformation,
    secure: true
  });

  return {
    url: signedUrl,
    expiresAt: new Date(expireAt * 1000).toISOString(),
    expiresInMinutes: Math.floor(expiresInSeconds / 60)
  };
}

// ── GET /api/video/protected-url ─────────────────────────────────
// الفرونت يطلب رابط محمي لكل فيديو قبل تشغيله
app.post('/api/video/protected-url', authMiddleware, async (req, res) => {
  try {
    const { cloudinaryPublicId, lessonTitle } = req.body;

    if (!cloudinaryPublicId) {
      return res.status(400).json({ error: 'cloudinaryPublicId مطلوب' });
    }

    // جلب بيانات الطالب من قاعدة البيانات
    const student = await User.findById(req.user.id).select('name phone _id');
    if (!student) {
      return res.status(404).json({ error: 'الطالب غير موجود' });
    }

    const studentName = student.name || 'طالب';
    const studentId = student._id.toString();
    const studentPhone = student.phone || '';

    // توليد الرابط المحمي (يصلح لمدة ساعتين)
    const protected_video = generateProtectedVideoUrl(
      cloudinaryPublicId,
      `${studentName} ${studentPhone ? '| ' + studentPhone : ''}`,
      studentId,
      7200 // ساعتان
    );

    // تسجيل الوصول للفيديو
    console.log(`🎬 وصول محمي: ${studentName} (${studentId}) → ${lessonTitle || cloudinaryPublicId}`);

    res.json({
      success: true,
      ...protected_video,
      studentName,
      message: 'رابط محمي تم توليده بنجاح'
    });

  } catch (err) {
    console.error('Protected URL Error:', err.message);
    res.status(500).json({ error: 'فشل في توليد الرابط المحمي' });
  }
});

// ── POST /api/video/upload-protected ──────────────────────────────
// رفع فيديو جديد لـ Cloudinary مع إعدادات الحماية
app.post('/api/video/upload-protected', authMiddleware, async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح - يجب أن تكون أدمن' });
    }

    // رفع الفيديو لـ Cloudinary في مجلد محمي
    const { videoBase64, fileName, courseId } = req.body;

    if (!videoBase64) {
      return res.status(400).json({ error: 'الفيديو مطلوب' });
    }

    const uploadResult = await cloudinary.uploader.upload(videoBase64, {
      resource_type: 'video',
      folder: `protected_courses/${courseId || 'general'}`,
      use_filename: true,
      unique_filename: true,
      access_mode: 'authenticated', // يتطلب Signed URL للوصول
      chunk_size: 6000000, // 6MB chunks
    });

    res.json({
      success: true,
      publicId: uploadResult.public_id,
      duration: uploadResult.duration,
      format: uploadResult.format,
      message: 'تم رفع الفيديو بحماية كاملة ✅'
    });

  } catch (err) {
    console.error('Upload Protected Video Error:', err.message);
    res.status(500).json({ error: `فشل في رفع الفيديو: ${err.message}` });
  }
});

// ══════════════════════════════════════════════════════════════════
// 🎥 JITSI MEET LIVE MEETINGS & SESSIONS API
// ══════════════════════════════════════════════════════════════════

// 1. Get Live Meetings (Admin: all, Student: tailored to grade & enrolled courses)
app.get('/api/live-meetings', authMiddleware, async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;

    if (userRole === 'admin') {
      const meetings = await LiveMeeting.find().sort({ scheduledAt: -1 });
      return res.json(meetings);
    }

    // For students: find enrolled courses first
    const user = await User.findById(userId).select('grade');
    const studentGrade = user?.grade || req.user.grade || '';

    const enrolledRequests = await EnrollmentRequest.find({
      studentId: userId,
      status: 'approved'
    }).select('courseId');
    const enrolledCourseIds = enrolledRequests.map(r => r.courseId);

    // Criteria:
    // - status is 'live' or 'scheduled' OR (status === 'ended' and updatedAt within last 12 hours)
    // - AND (grade === 'all' OR grade === studentGrade OR courseId in enrolledCourseIds)
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

    const gradeQuery = [{ grade: 'all' }, { grade: null }, { grade: '' }];
    if (studentGrade) {
      gradeQuery.push({ grade: studentGrade });
    }
    if (enrolledCourseIds.length > 0) {
      gradeQuery.push({ courseId: { $in: enrolledCourseIds } });
    }

    const meetings = await LiveMeeting.find({
      $and: [
        {
          $or: [
            { status: { $in: ['live', 'scheduled'] } },
            { status: 'ended', updatedAt: { $gte: twelveHoursAgo } }
          ]
        },
        { $or: gradeQuery }
      ]
    }).sort({ status: -1, scheduledAt: 1 });

    res.json(meetings);
  } catch (err) {
    console.error('Error fetching live meetings:', err);
    res.status(500).json({ error: 'فشل في جلب الحصص المباشرة' });
  }
});

// 2. Get Single Meeting by ID or roomName
app.get('/api/live-meetings/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    let meeting = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      meeting = await LiveMeeting.findById(id);
    }
    if (!meeting) {
      meeting = await LiveMeeting.findOne({ roomName: id });
    }
    if (!meeting) {
      return res.status(404).json({ error: 'الحصة المباشرة غير موجودة' });
    }
    res.json(meeting);
  } catch (err) {
    console.error('Error getting meeting:', err);
    res.status(500).json({ error: 'فشل في جلب بيانات الحصة' });
  }
});

// 3. Create Live Meeting (Admin only)
app.post('/api/live-meetings', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح - مطلوب صلاحيات المشرف' });
    }

    const {
      title,
      description,
      courseId,
      courseTitle,
      grade,
      instructorName,
      scheduledAt,
      duration,
      password,
      status
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'عنوان الحصة المباشرة مطلوب' });
    }

    // Auto-generate a clean, unique room name for Jitsi Meet
    const randSuffix = Math.random().toString(36).substring(2, 8);
    const roomName = `alkafyafe_live_${Date.now()}_${randSuffix}`;

    const newMeeting = new LiveMeeting({
      title: title.trim(),
      description: description ? description.trim() : '',
      roomName,
      courseId: courseId || null,
      courseTitle: courseTitle || '',
      grade: grade || 'all',
      instructorName: instructorName || 'مستر إسلام القيافي',
      instructorId: req.user.id,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      duration: Number(duration) || 60,
      password: password ? password.trim() : '',
      status: status || 'scheduled',
      attendees: []
    });

    await newMeeting.save();
    res.status(201).json({ success: true, meeting: newMeeting });
  } catch (err) {
    console.error('Error creating live meeting:', err);
    res.status(500).json({ error: `فشل في إنشاء الحصة المباشرة: ${err.message}` });
  }
});

// 4. Update Live Meeting (Admin only)
app.put('/api/live-meetings/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح - مطلوب صلاحيات المشرف' });
    }

    const { id } = req.params;
    const updateData = { ...req.body };

    if (updateData.scheduledAt) {
      updateData.scheduledAt = new Date(updateData.scheduledAt);
    }
    if (updateData.duration) {
      updateData.duration = Number(updateData.duration);
    }

    const updated = await LiveMeeting.findByIdAndUpdate(id, updateData, { new: true });
    if (!updated) {
      return res.status(404).json({ error: 'الحصة المباشرة غير موجودة' });
    }

    res.json({ success: true, meeting: updated });
  } catch (err) {
    console.error('Error updating live meeting:', err);
    res.status(500).json({ error: 'فشل في تحديث الحصة المباشرة' });
  }
});

// 5. Delete Live Meeting (Admin only)
app.delete('/api/live-meetings/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'غير مصرح - مطلوب صلاحيات المشرف' });
    }

    const { id } = req.params;
    const deleted = await LiveMeeting.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'الحصة المباشرة غير موجودة' });
    }

    res.json({ success: true, message: 'تم حذف الحصة المباشرة بنجاح' });
  } catch (err) {
    console.error('Error deleting live meeting:', err);
    res.status(500).json({ error: 'فشل في حذف الحصة المباشرة' });
  }
});

// 6. Record Student Attendance / Join Meeting
app.post('/api/live-meetings/:id/join', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const meeting = await LiveMeeting.findById(id);
    if (!meeting) {
      return res.status(404).json({ error: 'الحصة المباشرة غير موجودة' });
    }

    const userId = req.user.id;
    const userRole = req.user.role;

    // If student, record attendance if not already present
    if (userRole === 'student') {
      const alreadyJoined = meeting.attendees.some(a => a.studentId === userId);
      if (!alreadyJoined) {
        meeting.attendees.push({
          studentId: userId,
          studentName: req.user.name || 'طالب',
          studentPhone: req.user.phone || '',
          joinedAt: new Date()
        });
        await meeting.save();
      }
    }

    res.json({
      success: true,
      roomName: meeting.roomName,
      password: meeting.password,
      title: meeting.title,
      status: meeting.status,
      instructorName: meeting.instructorName
    });
  } catch (err) {
    console.error('Error recording meeting join:', err);
    res.status(500).json({ error: 'فشل في تسجيل الانضمام للحصة' });
  }
});

// ──────────────────────────────────────────────────────────────────


// ── Google Search Console Verification Endpoint ──
app.get('/googlec1137c18e7ec0caf.html', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send('google-site-verification: googlec1137c18e7ec0caf.html');
});

// ── Serve Frontend SPA ──
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      return next();
    }
    const indexPath = path.join(publicPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    next();
  });
}

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
