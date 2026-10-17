const http = require('http');
const https = require('https');

// Helper for making JSON HTTP/HTTPS requests
function request(urlStr, options = {}, bodyData = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    let bodyString = null;
    if (bodyData) {
      bodyString = JSON.stringify(bodyData);
      reqOptions.headers['Content-Type'] = 'application/json';
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyString);
    }

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

async function main() {
  try {
    console.log('1. Attempting login as admin on live server...');
    const baseUrl = 'https://alkafyafe-back.vercel.app'; // or https://www.alkafyafe.com
    
    // Try logging in
    let loginRes = await request(`${baseUrl}/api/login`, { method: 'POST' }, {
      phone: '01098744710',
      password: '12344321'
    });

    if (loginRes.status !== 200 || !loginRes.data.token) {
      console.log('Main domain login failed, status:', loginRes.status, loginRes.data);
      console.log('Trying direct local/alternative login...');
    }

    const token = loginRes.data.token;
    console.log('✅ Admin login successful! Token obtained.');

    console.log('2. Fetching courses...');
    const coursesRes = await request(`${baseUrl}/api/courses`);
    const courses = coursesRes.data;
    console.log(`Found ${courses.length} courses:`);
    courses.forEach(c => console.log(` - [${c.id || c._id}] ${c.title}`));

    let targetCourse = courses.find(c => 
      c.title.includes('فرنسا') || 
      c.title.includes('فرنسي') || 
      c.title.includes('تختار') || 
      c.title.includes('الفرنسية')
    );

    if (!targetCourse && courses.length > 0) {
      targetCourse = courses[0];
    }

    if (!targetCourse) {
      console.error('❌ No courses found to attach quiz to.');
      return;
    }

    console.log(`\n🎯 Selected Target Course: "${targetCourse.title}" (ID: ${targetCourse.id || targetCourse._id})`);

    const questions = [
      { text: "1. ما الهدف الأساسي من دراسة اللغة الفرنسية في أولى ثانوي؟", options: ["حفظ كلمات فقط", "تعلم لغة عالمية للتواصل والدراسة", "دراسة الرياضيات", "تعلم البرمجة"], correctOptionIndex: 1 },
      { text: "2. الفرنسية تُعد من أكثر اللغات استخدامًا في:", options: ["دولة واحدة", "قارة واحدة فقط", "أكثر من 30 دولة", "مصر فقط"], correctOptionIndex: 2 },
      { text: "3. تعلم الفرنسية يساعدك في:", options: ["السفر فقط", "الدراسة والعمل والتواصل", "اللعب فقط", "لا شيء"], correctOptionIndex: 1 },
      { text: "4. اللغة الفرنسية هي اللغة الرسمية في:", options: ["فرنسا فقط", "فرنسا وعدة دول أخرى", "الصين", "اليابان"], correctOptionIndex: 1 },
      { text: "5. من مميزات تعلم الفرنسية أنها:", options: ["صعبة جدًا ولا تُستخدم", "لغة العلوم والثقافة والفنون", "لغة قديمة فقط", "لا تفيد في المستقبل"], correctOptionIndex: 1 },
      { text: "6. إذا أتقنت الفرنسية يمكنك:", options: ["متابعة محتوى عالمي", "فهم الكتب والأفلام الفرنسية", "التواصل مع ملايين الأشخاص", "جميع ما سبق"], correctOptionIndex: 3 },
      { text: "7. أي من التالي يُعد دافعًا قويًا لتعلم الفرنسية؟", options: ["المنح الدراسية", "فرص العمل", "السفر", "جميع ما سبق"], correctOptionIndex: 3 },
      { text: "8. عدد متحدثي الفرنسية حول العالم يزيد عن:", options: ["20 مليون", "80 مليون", "300 مليون", "10 ملايين"], correctOptionIndex: 2 },
      { text: "9. الفرنسية هي إحدى اللغات الرسمية في:", options: ["الأمم المتحدة", "الاتحاد الأوروبي", "اللجنة الأولمبية", "جميع ما سبق"], correctOptionIndex: 3 },
      { text: "10. دراسة الفرنسية تُنمي:", options: ["مهارات التفكير", "مهارات التواصل", "الثقة بالنفس", "جميع ما سبق"], correctOptionIndex: 3 },
      { text: "11. تعلم الفرنسية يفتح لك فرصًا في:", options: ["السياحة", "الترجمة", "التعليم", "جميع ما سبق"], correctOptionIndex: 3 },
      { text: "12. أفضل طريقة لتعلم الفرنسية هي:", options: ["الحفظ فقط", "الممارسة والاستماع والتدريب", "عدم المذاكرة", "مشاهدة مباراة"], correctOptionIndex: 1 },
      { text: "13. يبدأ تعلم اللغة الفرنسية بـ:", options: ["القواعد المعقدة", "الحروف والنطق والكلمات الأساسية", "الأدب الفرنسي", "كتابة المقالات"], correctOptionIndex: 1 },
      { text: "14. النجاح في الفرنسية يحتاج إلى:", options: ["المذاكرة قبل الامتحان فقط", "الممارسة المستمرة", "الحفظ ليلة الامتحان", "عدم حل تدريبات"], correctOptionIndex: 1 },
      { text: "15. أي مهارة ليست من مهارات تعلم اللغة؟", options: ["الاستماع", "التحدث", "القراءة", "السباحة"], correctOptionIndex: 3 },
      { text: "16. تعلم لغة جديدة يساعد على:", options: ["تنمية الذاكرة", "زيادة التركيز", "تطوير العقل", "جميع ما سبق"], correctOptionIndex: 3 },
      { text: "17. الطالب المتميز في الفرنسية يعتمد على:", options: ["التدريب اليومي", "عدم حل الواجب", "الغياب", "الإهمال"], correctOptionIndex: 0 },
      { text: "18. لماذا تعتبر الفرنسية لغة مهمة؟", options: ["لأنها لغة عالمية", "لأنها تُستخدم في مجالات كثيرة", "لأنها تفتح فرصًا مستقبلية", "جميع ما سبق"], correctOptionIndex: 3 },
      { text: "19. عند بداية تعلم الفرنسية يجب أن تكون:", options: ["متحمسًا وصبورًا", "متكاسلًا", "متوترًا", "غير مهتم"], correctOptionIndex: 0 },
      { text: "20. شعار طالب الفرنسية الناجح هو:", options: ["أؤجل المذاكرة", "أتعلم خطوة بخطوة حتى الإتقان", "لا أراجع الدروس", "أذاكر قبل الامتحان فقط"], correctOptionIndex: 1 }
    ];

    const quizPayload = {
      courseId: (targetCourse.id || targetCourse._id).toString(),
      unitTitle: "الوحدة الأولى",
      title: "كويز تمهيدي: ليه تختار اللغة الفرنسية في أولى ثانوي؟ 🇫🇷",
      questions
    };

    console.log('3. Posting Quiz to backend...');
    const postRes = await request(`${baseUrl}/api/quizzes`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }, quizPayload);

    if (postRes.status === 200 || postRes.status === 201) {
      console.log('🎉 QUIZ CREATED SUCCESSFULLY ON LIVE PLATFORM!');
      console.log('Quiz ID:', postRes.data.id || postRes.data._id);
    } else {
      console.error('Failed to create quiz:', postRes.status, postRes.data);
    }

  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
