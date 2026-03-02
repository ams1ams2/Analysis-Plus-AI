// hide flash messages after 5s
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      document.querySelectorAll('.flash').forEach(el => el.remove());
    }, 5000);
  });
  