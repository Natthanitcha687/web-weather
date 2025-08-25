// web/public/config.js
(function () {
  // ใช้ API ที่ Render สร้าง
  window.API_URL = 'https://web-weather-api.onrender.com';

  // เวลาพัฒนาในเครื่อง ให้ใช้ localhost
  if (location.hostname === 'localhost') {
    window.API_URL = 'http://localhost:4000';
  }
})();
