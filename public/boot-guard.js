(function () {
  var timer = window.setTimeout(function () {
    var splash = document.querySelector('.himkontur-boot');
    if (!splash) return;

    var message = splash.querySelector('[data-boot-message]');
    var line = splash.querySelector('.himkontur-boot-line');
    var retry = splash.querySelector('[data-boot-retry]');

    if (message) message.textContent = 'Запуск занял слишком много времени';
    if (line) line.hidden = true;
    if (retry) {
      retry.hidden = false;
      retry.addEventListener('click', function () { window.location.reload(); }, { once: true });
    }
  }, 12000);

  window.addEventListener('himkontur-ready', function () {
    window.clearTimeout(timer);
  }, { once: true });
}());
