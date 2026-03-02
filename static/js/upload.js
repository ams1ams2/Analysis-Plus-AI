// show chosen filename
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.querySelector('input[type="file"]');
    const label = document.createElement('span');
    fileInput.parentNode.append(label);
    fileInput.onchange = () => {
      label.textContent = fileInput.files[0]?.name || '';
    };
  });
  