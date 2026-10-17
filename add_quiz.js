require('dotenv').config();
const mongoose = require('mongoose');
const { Course, Quiz } = require('./models');

const mongoUri = process.env.MONGO_URI || 'mongodb+srv://alkafy:alkafy@cluster0.l0t8qcc.mongodb.net/?appName=Cluster0';

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected!');

    const courses = await Course.find();
    console.log('Available courses count:', courses.length);
    courses.forEach(c => console.log(`- Course ID: ${c._id}, Title: "${c.title}"`));

    // Find French course matching "ليه تختار" or "الفرنسية"
    let targetCourse = courses.find(c => c.title.includes('فرنسا') || c.title.includes('فرنسي') || c.title.includes('تختار') || c.title.includes('الفرنسية'));
    
    if (!targetCourse && courses.length > 0) {
      console.log('Target course not found by exact string, using first course fallback');
      targetCourse = courses[0];
    }

    if (!targetCourse) {
      console.error('No courses found in database!');
      process.exit(1);
    }

    console.log(`\nSelected target course: "${targetCourse.title}" (ID: ${targetCourse._id})`);

    const questions = [
      {
        text: "1. ما الهدف الأساسي من دراسة اللغة الفرنسية في أولى ثانوي؟",
        options: [
          "حفظ كلمات فقط",
          "تعلم لغة عالمية للتواصل والدراسة",
          "دراسة الرياضيات",
          "تعلم البرمجة"
        ],
        correctOptionIndex: 1
      },
      {
        text: "2. الفرنسية تُعد من أكثر اللغات استخدامًا في:",
        options: [
          "دولة واحدة",
          "قارة واحدة فقط",
          "أكثر من 30 دولة",
          "مصر فقط"
        ],
        correctOptionIndex: 2
      },
      {
        text: "3. تعلم الفرنسية يساعدك في:",
        options: [
          "السفر فقط",
          "الدراسة والعمل والتواصل",
          "اللعب فقط",
          "لا شيء"
        ],
        correctOptionIndex: 1
      },
      {
        text: "4. اللغة الفرنسية هي اللغة الرسمية في:",
        options: [
          "فرنسا فقط",
          "فرنسا وعدة دول أخرى",
          "الصين",
          "اليابان"
        ],
        correctOptionIndex: 1
      },
      {
        text: "5. من مميزات تعلم الفرنسية أنها:",
        options: [
          "صعبة جدًا ولا تُستخدم",
          "لغة العلوم والثقافة والفنون",
          "لغة قديمة فقط",
          "لا تفيد في المستقبل"
        ],
        correctOptionIndex: 1
      },
      {
        text: "6. إذا أتقنت الفرنسية يمكنك:",
        options: [
          "متابعة محتوى عالمي",
          "فهم الكتب والأفلام الفرنسية",
          "التواصل مع ملايين الأشخاص",
          "جميع ما سبق"
        ],
        correctOptionIndex: 3
      },
      {
        text: "7. أي من التالي يُعد دافعًا قويًا لتعلم الفرنسية؟",
        options: [
          "المنح الدراسية",
          "فرص العمل",
          "السفر",
          "جميع ما سبق"
        ],
        correctOptionIndex: 3
      },
      {
        text: "8. عدد متحدثي الفرنسية حول العالم يزيد عن:",
        options: [
          "20 مليون",
          "80 مليون",
          "300 مليون",
          "10 ملايين"
        ],
        correctOptionIndex: 2
      },
      {
        text: "9. الفرنسية هي إحدى اللغات الرسمية في:",
        options: [
          "الأمم المتحدة",
          "الاتحاد الأوروبي",
          "اللجنة الأولمبية",
          "جميع ما سبق"
        ],
        correctOptionIndex: 3
      },
      {
        text: "10. دراسة الفرنسية تُنمي:",
        options: [
          "مهارات التفكير",
          "مهارات التواصل",
          "الثقة بالنفس",
          "جميع ما سبق"
        ],
        correctOptionIndex: 3
      },
      {
        text: "11. تعلم الفرنسية يفتح لك فرصًا في:",
        options: [
          "السياحة",
          "الترجمة",
          "التعليم",
          "جميع ما سبق"
        ],
        correctOptionIndex: 3
      },
      {
        text: "12. أفضل طريقة لتعلم الفرنسية هي:",
        options: [
          "الحفظ فقط",
          "الممارسة والاستماع والتدريب",
          "عدم المذاكرة",
          "مشاهدة مباراة"
        ],
        correctOptionIndex: 1
      },
      {
        text: "13. يبدأ تعلم اللغة الفرنسية بـ:",
        options: [
          "القواعد المعقدة",
          "الحروف والنطق والكلمات الأساسية",
          "الأدب الفرنسي",
          "كتابة المقالات"
        ],
        correctOptionIndex: 1
      },
      {
        text: "14. النجاح في الفرنسية يحتاج إلى:",
        options: [
          "المذاكرة قبل الامتحان فقط",
          "الممارسة المستمرة",
          "الحفظ ليلة الامتحان",
          "عدم حل تدريبات"
        ],
        correctOptionIndex: 1
      },
      {
        text: "15. أي مهارة ليست من مهارات تعلم اللغة؟",
        options: [
          "الاستماع",
          "التحدث",
          "القراءة",
          "السباحة"
        ],
        correctOptionIndex: 3
      },
      {
        text: "16. تعلم لغة جديدة يساعد على:",
        options: [
          "تنمية الذاكرة",
          "زيادة التركيز",
          "تطوير العقل",
          "جميع ما سبق"
        ],
        correctOptionIndex: 3
      },
      {
        text: "17. الطالب المتميز في الفرنسية يعتمد على:",
        options: [
          "التدريب اليومي",
          "عدم حل الواجب",
          "الغياب",
          "الإهمال"
        ],
        correctOptionIndex: 0
      },
      {
        text: "18. لماذا تعتبر الفرنسية لغة مهمة؟",
        options: [
          "لأنها لغة عالمية",
          "لأنها تُستخدم في مجالات كثيرة",
          "لأنها تفتح فرصًا مستقبلية",
          "جميع ما سبق"
        ],
        correctOptionIndex: 3
      },
      {
        text: "19. عند بداية تعلم الفرنسية يجب أن تكون:",
        options: [
          "متحمسًا وصبورًا",
          "متكاسلًا",
          "متوترًا",
          "غير مهتم"
        ],
        correctOptionIndex: 0
      },
      {
        text: "20. شعار طالب الفرنسية الناجح هو:",
        options: [
          "أؤجل المذاكرة",
          "أتعلم خطوة بخطوة حتى الإتقان",
          "لا أراجع الدروس",
          "أذاكر قبل الامتحان فقط"
        ],
        correctOptionIndex: 1
      }
    ];

    const quizData = {
      courseId: targetCourse._id.toString(),
      unitTitle: "الوحدة الأولى",
      title: "كويز تمهيدي: ليه تختار اللغة الفرنسية في أولى ثانوي؟ 🇫🇷",
      questions: questions
    };

    const newQuiz = new Quiz(quizData);
    await newQuiz.save();

    console.log(`\n✅ Quiz created successfully! Quiz ID: ${newQuiz._id}`);
    process.exit(0);
  } catch (err) {
    console.error('Error adding quiz:', err);
    process.exit(1);
  }
}

run();
