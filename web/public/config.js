(function () {
  if (!window.API_URL || typeof window.API_URL !== 'string') {
    window.API_URL = location.protocol + '//' + location.hostname + ':4000';
  }
})();