/* Reveal Animation + Parallax + Ripple Effect on Nav Buttons */
document.addEventListener('DOMContentLoaded', () => {
    /* 1. إظهار بطاقات المزايا */
    const cards = document.querySelectorAll('.feature');
    const obs = new IntersectionObserver(entries=>{
      entries.forEach(e=>e.target.classList.toggle('visible', e.isIntersecting));
    }, {threshold:0.35});
    cards.forEach(c=>obs.observe(c));
  
    /* 2. Parallax بسيط للـ blobs */
    const blob1 = document.querySelector('.blob1') || document.querySelector('.blob');
    const blob2 = document.querySelector('.blob2') || document.querySelector('.blob');
    window.addEventListener('mousemove', e=>{
      const x = (e.clientX / window.innerWidth - 0.5) * 40;
      const y = (e.clientY / window.innerHeight - 0.5) * 40;
      blob1.style.transform = `translate(${-x}px,${-y}px)`;
      blob2.style.transform = `translate(${x}px,${y}px)`;
      /* تحريك الخلفية المتدرجة */
      document.body.style.setProperty('--x', `${-x/2}px`);
      document.body.style.setProperty('--y', `${-y/2}px`);
    });
  
    /* 3. تأثير Ripple على أزرار التنقّل */
    document.querySelectorAll('.nav-btn').forEach(btn=>{
      btn.addEventListener('click', e=>{
        const circle = document.createElement('span');
        const d = Math.max(btn.clientWidth, btn.clientHeight);
        circle.style.width = circle.style.height = `${d}px`;
        circle.style.left = `${e.offsetX - d/2}px`;
        circle.style.top  = `${e.offsetY - d/2}px`;
        circle.className  = 'ripple';
        btn.appendChild(circle);
        setTimeout(()=>circle.remove(), 600);
      });
    });
  });
  