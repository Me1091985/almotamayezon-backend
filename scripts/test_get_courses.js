const http = require('http');

http.get('http://localhost:5005/api/courses', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const courses = JSON.parse(data);
      console.log('✅ API returned', courses.length, 'courses:');
      courses.forEach(c => {
        console.log(`- [${c.id || c._id}] "${c.title}" (Grade: "${c.grade || 'الكل'}")`);
      });
    } catch (e) {
      console.error('Parse error:', e, data);
    }
  });
}).on('error', err => {
  console.error('Request error:', err.message);
});
