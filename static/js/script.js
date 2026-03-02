document.addEventListener('DOMContentLoaded', () => {
    const form        = document.getElementById('query-form');
    const questionIn  = document.getElementById('question');
    const resultDiv   = document.getElementById('result');
    const ctx         = document.getElementById('chart').getContext('2d');
    const demoToggle  = document.getElementById('demo-toggle');
    const chartTypeEl = document.getElementById('chart-type');
    let chartInstance = null;
  
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const q    = questionIn.value.trim();
      const demo = demoToggle.checked;
      const type = chartTypeEl.value;
  
      if (!q) return;
      resultDiv.innerHTML = '<p>جارٍ المعالجة... ⏳</p>';
      if (chartInstance) { chartInstance.destroy(); }
  
      try {
        const res = await fetch('/api/query', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({question: q, demo})
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
  
        // عرض SQL
        resultDiv.innerHTML = `<h3>🔍 SQL:</h3><pre>${data.sql}</pre>`;
  
        // بناء جدول النتائج
        if (data.results.length) {
          const cols = Object.keys(data.results[0]);
          let html = '<h3>📋 النتائج:</h3><table><thead><tr>';
          cols.forEach(c => html += `<th>${c}</th>`);
          html += '</tr></thead><tbody>';
          data.results.forEach(r => {
            html += '<tr>' + cols.map(c=>`<td>${r[c]}</td>`).join('') + '</tr>';
          });
          html += '</tbody></table>';
          resultDiv.innerHTML += html;
  
          // تجهيز بيانات الرسم البياني
          const labels = data.results.map((r,i) => {
            // إذا هناك عمود نصي أول، نستخدمه كـ label
            const txtCol = cols.find(c => isNaN(r[c])) || cols[0];
            return r[txtCol] || `#${i+1}`;
          });
          // اختيار العمود الرقمي الأول
          const numCol = cols.find(c => !isNaN(data.results[0][c])) || cols[1];
          const values = data.results.map(r => Number(r[numCol] || 0));
  
          // إنشاء الرسم
          chartInstance = new Chart(ctx, {
            type,
            data: {
              labels,
              datasets: [{ label: numCol, data: values }]
            },
            options: {}
          });
        } else {
          resultDiv.innerHTML += '<p>لا توجد نتائج. 😕</p>';
        }
      } catch (err) {
        resultDiv.innerHTML = `<p>❗ خطأ: ${err.message}</p>`;
      }
    });
  });
  