// static/js/index.js
// تحليل بلس – لوحة الاستعلام (مع SQL منفصل وقائمة أعمدة)

document.addEventListener('DOMContentLoaded', () => {
    // عناصر DOM
    const connectOpen   = document.getElementById('connect-open'),
          connectBtn    = document.getElementById('connect-btn'),
          disconnectBtn = document.getElementById('disconnect-btn'),
          dbHostInput   = document.getElementById('db-host'),
          dbPortInput   = document.getElementById('db-port'),
          dbUserInput   = document.getElementById('db-user'),
          dbPasswordInput = document.getElementById('db-password'),
          dbNameInput   = document.getElementById('db-name'),
          form          = document.getElementById('query-form'),
          questionInput = document.getElementById('question'),
          realRadio     = document.getElementById('realRadio'),
          demoRadio     = document.getElementById('demoRadio'),
          modelSelect   = document.getElementById('model-select'),
          liveToggle    = document.getElementById('live-toggle'),
          spinner       = document.getElementById('spinner'),
          sqlFrame      = document.getElementById('sql-frame'),
          colList       = document.getElementById('col-list'),
          resultContainer = document.querySelector('.result-container'),
          chartCanvas   = document.getElementById('chart'),
          chartCtx      = chartCanvas.getContext('2d'),
          showDataShapeBtn = document.getElementById('show-data-shape'),
          uploadDataOpen = document.getElementById('upload-data-open'),
          uploadDataFile = document.getElementById('upload-data-file'),
          uploadDataBtn = document.getElementById('upload-data-btn'),
          uploadDataStatus = document.getElementById('upload-data-status'),
          chartTypeSelect = document.getElementById('chart-type-select'),
          xAxisSelect = document.getElementById('x-axis-select'),
          yAxisSelect = document.getElementById('y-axis-select');
  
    let chart = null, liveID = null, lastResults = [];
    const connectModal = new bootstrap.Modal('#connectModal');
    const dataShapeModal = new bootstrap.Modal('#dataShapeModal');
    const uploadDataModal = document.getElementById('uploadDataModal') ? new bootstrap.Modal('#uploadDataModal') : null;

    // تحميل قائمة نماذج OpenRouter
    async function loadModels() {
      try {
        const res = await fetch('/api/models');
        const data = await res.json();
        modelSelect.innerHTML = '';
        (data.models || []).forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = '🤖 ' + (m.name || m.id);
          if (m.id === (data.default || 'openai/gpt-4o')) opt.selected = true;
          modelSelect.appendChild(opt);
        });
        if (!modelSelect.options.length) {
          modelSelect.innerHTML = '<option value="openai/gpt-4o">🤖 GPT-4o</option>';
        }
      } catch (e) {
        console.error('Load models:', e);
        modelSelect.innerHTML = '<option value="openai/gpt-4o">🤖 GPT-4o</option>';
      }
    }
    loadModels();
  
    // تفعيل tooltips
    document.querySelectorAll('[data-bs-toggle="tooltip"]')
      .forEach(el=>new bootstrap.Tooltip(el));
  
    // Ripple effect
    document.addEventListener('click', e => {
      const btn = e.target.closest('button, .ask-btn');
      if (!btn) return;
      const d = Math.max(btn.clientWidth, btn.clientHeight);
      const r = document.createElement('span');
      r.className = 'ripple';
      r.style.width = r.style.height = `${d}px`;
      r.style.left = `${e.offsetX - d/2}px`;
      r.style.top  = `${e.offsetY - d/2}px`;
      btn.appendChild(r);
      setTimeout(()=>r.remove(),600);
    });
  
    // حالة الاتصال (لإظهار/إخفاء الأزرار)
    function updateConnectionButtons(isConnected) {
        if (isConnected) {
            connectOpen.classList.add('d-none');
            disconnectBtn.classList.remove('d-none');
        } else {
            connectOpen.classList.remove('d-none');
            disconnectBtn.classList.add('d-none');
        }
    }

    // التحقق من حالة الاتصال عند تحميل الصفحة
    async function checkConnectionStatus() {
        try {
            const res = await fetch('/api/connection_status');
            const data = await res.json();
            updateConnectionButtons(data.isConnected);
        } catch (e) {
            console.error("Error checking connection status:", e);
            updateConnectionButtons(false);
        }
    }
    checkConnectionStatus();

    // عرض شكل البيانات الأساسية (مع معلومات توضيحية وتحميل تدريجي)
    if (showDataShapeBtn) {
      showDataShapeBtn.addEventListener('click', async () => {
        const demo = demoRadio && demoRadio.checked;
        const schemaEl = document.getElementById('data-shape-schema');
        const infoEl = document.getElementById('data-shape-info');
        const tableNameEl = document.getElementById('data-shape-table-name');
        const columnsEl = document.getElementById('data-shape-columns');
        const theadEl = document.getElementById('data-shape-thead');
        const sampleEl = document.getElementById('data-shape-sample');
        const loadMoreEl = document.getElementById('data-shape-load-more');
        const errEl = document.getElementById('data-shape-error');
        const sampleWrapper = document.getElementById('data-shape-sample-wrapper');
        if (errEl) errEl.classList.add('d-none');
        if (loadMoreEl) loadMoreEl.classList.add('d-none');
        schemaEl.textContent = 'جاري التحميل…';
        if (infoEl) infoEl.innerHTML = '';
        tableNameEl.textContent = '';
        columnsEl.textContent = '';
        theadEl.innerHTML = '';
        sampleEl.innerHTML = '';
        dataShapeModal.show();
        let dataShapeCols = [];
        let dataShapeOffset = 0;
        let dataShapeTotal = 0;
        let dataShapeLoading = false;
        const pageSize = 300;

        function appendRows(rows) {
          if (!rows.length) return;
          rows.forEach(row => {
            const tr = document.createElement('tr');
            dataShapeCols.forEach(c => {
              const td = document.createElement('td');
              td.textContent = row[c] != null ? row[c] : '';
              tr.appendChild(td);
            });
            sampleEl.appendChild(tr);
          });
        }

        function loadMoreSample() {
          if (dataShapeOffset >= dataShapeTotal || dataShapeLoading) return;
          dataShapeLoading = true;
          if (loadMoreEl) loadMoreEl.classList.remove('d-none');
          fetch('/api/data_shape_sample?demo=' + (demo ? '1' : '0') + '&offset=' + dataShapeOffset + '&limit=' + pageSize)
            .then(r => r.json())
            .then(data => {
              if (data.rows && data.rows.length) {
                appendRows(data.rows);
                dataShapeOffset += data.rows.length;
              }
              dataShapeLoading = false;
              if (loadMoreEl) loadMoreEl.classList.add('d-none');
            })
            .catch(() => { dataShapeLoading = false; if (loadMoreEl) loadMoreEl.classList.add('d-none'); });
        }

        const shapeBody = document.getElementById('data-shape-body');
        if (shapeBody) {
          shapeBody.addEventListener('scroll', function onScroll() {
            if (dataShapeTotal === 0) return;
            const { scrollTop, scrollHeight, clientHeight } = shapeBody;
            if (scrollHeight - scrollTop - clientHeight < 200 && dataShapeOffset < dataShapeTotal && !dataShapeLoading) {
              loadMoreSample();
            }
          });
        }

        try {
          const res = await fetch('/api/data_shape?demo=' + (demo ? '1' : '0'));
          const data = await res.json();
          if (!res.ok) {
            if (errEl) { errEl.textContent = data.error || 'حدث خطأ'; errEl.classList.remove('d-none'); }
            schemaEl.textContent = '';
            return;
          }
          schemaEl.textContent = data.schema || '—';
          dataShapeTotal = data.total_row_count || 0;
          dataShapeCols = data.columns || (data.sample && data.sample[0] ? Object.keys(data.sample[0]) : []);

          if (infoEl) {
            let infoHtml = '<strong>📊 معلومات عن البيانات</strong><br>';
            infoHtml += 'عدد الصفوف (الإجمالي): <strong>' + (dataShapeTotal.toLocaleString ? dataShapeTotal.toLocaleString('ar-SA') : dataShapeTotal) + '</strong><br>';
            infoHtml += 'عدد الأعمدة: <strong>' + (dataShapeCols.length) + '</strong><br>';
            if (data.table_name) infoHtml += 'اسم الجدول: <strong>' + data.table_name + '</strong><br>';
            if (data.column_types && Object.keys(data.column_types).length) {
              infoHtml += 'أنواع الأعمدة: ';
              infoHtml += dataShapeCols.map(c => c + ' <span class="badge bg-info">' + (data.column_types[c] || '—') + '</span>').join(' &nbsp; ');
            }
            infoEl.innerHTML = infoHtml;
          }
          if (data.table_name) tableNameEl.textContent = 'الجدول: ' + data.table_name;
          if (dataShapeCols.length) columnsEl.innerHTML = 'الأعمدة: ' + dataShapeCols.map(c => '<span class="badge bg-secondary me-1">' + c + '</span>').join('');

          if (dataShapeCols.length) {
            theadEl.innerHTML = '<tr>' + dataShapeCols.map(c => '<th>' + c + '</th>').join('') + '</tr>';
            if (data.sample && data.sample.length) {
              appendRows(data.sample);
              dataShapeOffset = data.sample.length;
              if (dataShapeOffset < dataShapeTotal) loadMoreSample();
            }
          } else {
            sampleEl.innerHTML = '<tr><td colspan="1" class="text-muted">لا توجد صفوف.</td></tr>';
          }
        } catch (e) {
          if (errEl) { errEl.textContent = e.message || 'فشل التحميل'; errEl.classList.remove('d-none'); }
          schemaEl.textContent = '';
        }
      });
    }

    // رفع بيانات (Excel / SQLite)
    if (uploadDataOpen && uploadDataModal) uploadDataOpen.addEventListener('click', () => { if (uploadDataStatus) uploadDataStatus.textContent = ''; if (uploadDataFile) uploadDataFile.value = ''; uploadDataModal.show(); });
    if (uploadDataBtn && uploadDataFile) {
      uploadDataBtn.addEventListener('click', async () => {
        const file = uploadDataFile.files[0];
        if (!file) { if (uploadDataStatus) { uploadDataStatus.textContent = 'اختر ملفاً أولاً.'; uploadDataStatus.className = 'mt-2 small text-danger'; } return; }
        if (uploadDataStatus) { uploadDataStatus.textContent = 'جاري الرفع…'; uploadDataStatus.className = 'mt-2 small text-muted'; }
        const fd = new FormData();
        fd.append('file', file);
        try {
          const res = await fetch('/api/upload_data', { method: 'POST', body: fd });
          const data = await res.json();
          if (!res.ok) throw data.error || 'فشل الرفع';
          if (uploadDataStatus) { uploadDataStatus.textContent = (data.message || 'تم الرفع بنجاح.') + (data.rows ? ' (عدد الصفوف: ' + data.rows + ')' : ''); uploadDataStatus.className = 'mt-2 small text-success'; }
          if (data.sample_data) sessionStorage.setItem('sample_data', JSON.stringify(data.sample_data));
          updateConnectionButtons(true);
          if (uploadDataModal) setTimeout(() => uploadDataModal.hide(), 1200);
        } catch (err) {
          if (uploadDataStatus) { uploadDataStatus.textContent = err || 'حدث خطأ.'; uploadDataStatus.className = 'mt-2 small text-danger'; }
        }
      });
    }

    // ربط القاعدة
    connectOpen.addEventListener('click', ()=>connectModal.show());
    connectBtn.addEventListener('click', async ()=>{
      const host = dbHostInput.value.trim();
      const port = dbPortInput.value.trim();
      const user = dbUserInput.value.trim();
      const password = dbPasswordInput.value.trim();
      const db_name = dbNameInput.value.trim();

      if(!host || !port || !user || !db_name) {
        alert('الرجاء إدخال جميع بيانات الاتصال.');
        return;
      }

      try {
        spinner.classList.remove('d-none');
        const res = await fetch('/api/connect', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({ host, port, user, password, db_name })
        });
        const data = await res.json();
        if(!res.ok) throw data.error||'خطأ في الربط';
        
        // حفظ العينات في الجلسة
        if (data.sample_data) {
            sessionStorage.setItem('sample_data', JSON.stringify(data.sample_data));
        }
        
        alert('✅ تم الربط بنجاح!');
        connectModal.hide();
        updateConnectionButtons(true);
      } catch(err){
        console.error(err); 
        alert('❌ '+err);
      } finally {
        spinner.classList.add('d-none');
      }
    });

    // قطع الاتصال
    disconnectBtn.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/disconnect', {
                method: 'POST'
            });
            if (!res.ok) throw new Error('فشل قطع الاتصال');
            sessionStorage.removeItem('sample_data');
            alert('✅ تم قطع الاتصال.');
            updateConnectionButtons(false);
        } catch (err) {
            console.error(err);
            alert('❌ حدث خطأ أثناء قطع الاتصال.');
        }
    });
  
    // تنفيذ الاستعلام
    form.addEventListener('submit', async e=>{
      e.preventDefault();
      if(liveID) clearInterval(liveID);
      await runQuery();
      if(liveToggle.checked) liveID = setInterval(runQuery,5000);
    });
  
    async function runQuery(){
      const q = questionInput.value.trim();
      if(!q) return;
      // لا تخفِ أو تفرغ أي عناصر أثناء التحديث
      spinner.classList.remove('d-none');

      const body = {
        question: q,
        model: modelSelect.value || 'openai/gpt-4o',
        demo: demoRadio.checked,
        sample: sessionStorage.getItem('sample_data') ? JSON.parse(sessionStorage.getItem('sample_data')) : null
      };

      try {
        const res = await fetch('/api/query',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if(!res.ok) throw data.error||'خطأ في الاستعلام';

        // عرض SQL بإطار
        sqlFrame.innerHTML = `<strong>SQL:</strong><pre>${data.sql}</pre>`;
        sqlFrame.classList.remove('d-none');

        // قائمة الأعمدة
        const cols = Object.keys(data.results[0]||{});
        colList.innerHTML = `<strong>الأعمدة:</strong> ` +
          cols.map(c=>`<span class="badge bg-secondary me-1">${c}</span>`).join('');
        colList.classList.remove('d-none');

        // تحديث الجدول فقط
        updateTable(data.results);

        // حفظ آخر نتائج لاستخدامها مع تغيّر اختيارات الرسم
        lastResults = Array.isArray(data.results) ? data.results : [];

        // تجهيز قوائم اختيار المحاور
        if (xAxisSelect && yAxisSelect && cols.length) {
          const makeOptions = (selectEl, placeholder) => {
            selectEl.innerHTML = '';
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = placeholder;
            selectEl.appendChild(opt);
            cols.forEach(c => {
              const o = document.createElement('option');
              o.value = c;
              o.textContent = c;
              selectEl.appendChild(o);
            });
          };
          makeOptions(xAxisSelect, 'تلقائي');
          makeOptions(yAxisSelect, 'تلقائي');
        }
        if (chartTypeSelect) {
          chartTypeSelect.value = (data.chartType && data.chartType !== '') ? data.chartType : 'auto';
        }

        // منطق الرسم البياني الجديد
        let validChart = data.showChart;
        let xCol = data.xCol;
        let yCol = data.yCol;
        if (xCol && !cols.includes(xCol)) xCol = null;
        if (yCol && !cols.includes(yCol)) yCol = null;

        if(validChart && (yCol === undefined || yCol === null || yCol === '')){
          validChart = false;
        }

        if(validChart){
          chartCanvas.style.display = '';
          const selectedType = (chartTypeSelect && chartTypeSelect.value && chartTypeSelect.value !== 'auto')
            ? chartTypeSelect.value
            : data.chartType;
          const selectedX = (xAxisSelect && xAxisSelect.value) ? xAxisSelect.value : xCol;
          const selectedY = (yAxisSelect && yAxisSelect.value) ? yAxisSelect.value : yCol;
          updateChart(data.results, selectedType, selectedX, selectedY);
          // أخفِ رسالة عدم وجود رسم
          let noChartMsg = document.getElementById('no-chart-msg');
          if(noChartMsg) noChartMsg.style.display = 'none';
        } else {
          chartCanvas.style.display = 'none';
          let axesInfo = document.getElementById('axes-info');
          if(axesInfo) axesInfo.style.display = 'none';
          // أظهر رسالة عدم وجود رسم
          let noChartMsg = document.getElementById('no-chart-msg');
          if(!noChartMsg){
            noChartMsg = document.createElement('div');
            noChartMsg.id = 'no-chart-msg';
            noChartMsg.style = 'text-align:center;color:#888;font-size:1.05rem;margin:12px 0 0 0;';
            chartCanvas.parentNode.appendChild(noChartMsg);
          }
          noChartMsg.textContent = 'لا توجد بيانات مناسبة لعرض رسم بياني.';
          noChartMsg.style.display = '';
        }
      } catch(err){
        console.error(err);
        resultContainer.innerHTML = `<div class="alert alert-danger">${err}</div>`;
        // Check connection status in case of query error
        checkConnectionStatus();
      } finally {
        spinner.classList.add('d-none');
      }
    }
  
    function updateTable(rows){
      if(!rows.length){
        resultContainer.innerHTML = '<p>لا توجد نتائج.</p>';
        return;
      }
      const cols = Object.keys(rows[0]);
      let html = '<table class="table table-striped text-center"><thead><tr>';
      cols.forEach(c=> html+=`<th>${c}</th>`);
      html+='</tr></thead><tbody>';
      // دالة تحويل مرنة للتواريخ والأوقات
      function formatDateFlexible(val){
        if(!val) return val;
        
        // Try parsing as Date object first
        let d = new Date(val);
        if (!isNaN(d) && d.getTimezoneOffset() !== d.getTimezoneOffset()) { // Basic check for valid date
            return d; // Return Date object for charting
        }

        // ISO أو صيغ SQL
        d = new Date(val);
        if(!isNaN(d.getTime())) return d.toISOString().slice(0,16).replace('T',' '); // Return formatted string for table display
        
        // dd-mm-yyyy hh:mm أو dd/mm/yyyy hh:mm
        let m = val.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})[ ,T]*(\d{2})?:?(\d{0,2})?(?::(\d{0,2}))?/);
        if(m){
          let [_, dd, mm, yyyy, h, min, s] = m;
          let dateStr = `${yyyy}-${mm}-${dd}${h ? 'T'+h + (min ? ':'+min + (s ? ':'+s : '') : '') : ''}`;
          d = new Date(dateStr);
          if(!isNaN(d.getTime())) return d.toISOString().slice(0,16).replace('T',' ');
        }
        // yyyy/mm/dd hh:mm
        m = val.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})[ ,T]*(\d{2})?:?(\d{0,2})?(?::(\d{0,2}))?/);
        if(m){
          let [_, yyyy, mm, dd, h, min, s] = m;
           let dateStr = `${yyyy}-${mm}-${dd}${h ? 'T'+h + (min ? ':'+min + (s ? ':'+s : '') : '') : ''}`;
          d = new Date(dateStr);
          if(!isNaN(d.getTime())) return d.toISOString().slice(0,16).replace('T',' ');
        }
        // فقط تاريخ
        m = val.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
        if(m){
          let [_, yyyy, mm, dd] = m;
          d = new Date(`${yyyy}-${mm}-${dd}`);
          if(!isNaN(d.getTime())) return d.toISOString().slice(0,10);
        }
        // إذا فشل كل شيء
        return val;
      }
      rows.forEach(rw=>{
        html+='<tr>';
        cols.forEach(c=>{
          let v = rw[c];
          if(/date|time/i.test(c) && v){
            // Format for table display, not for charting
            const dateObj = new Date(v); // Try to create Date object for display formatting
             if (!isNaN(dateObj.getTime())){
                 v = dateObj.toISOString().slice(0, 16).replace('T', ' '); // Example display format
             }
             // If it's not a recognized date format, keep original value
          }
          html += (v==='███')
            ? `<td class="private">███</td>`
            : `<td>${v}</td>`;
        });
        html+='</tr>';
      });
      html+='</tbody></table>';
      resultContainer.innerHTML = html;
    }
  
    function updateChart(rows,chartType,xCol,yCol){
      if(!rows.length) return;
      const cols = Object.keys(rows[0]);
      // استخدم xCol/yCol إذا وُجدت
      const labelCol = (xCol && cols.includes(xCol)) ? xCol : (cols.find(c=>isNaN(rows[0][c]))||cols[0]);
      const numCol   = (yCol && cols.includes(yCol)) ? yCol : (cols.find(c=>!isNaN(rows[0][c]))||cols[1]);
      
      let labels, values, chartOptions = {};
      let isDateAxis = false;

      // Check if the labelCol contains date values
      if (rows.length > 0) {
          const firstValue = rows[0][labelCol];
          const parsedDate = new Date(firstValue);
          if (!isNaN(parsedDate.getTime())) { // Check if it's a valid date
              isDateAxis = true;
          }
      }

      if (isDateAxis) {
          // Convert labels to Date objects for a time-series axis
          labels = rows.map(r => new Date(r[labelCol]));
          values = rows.map(r => Number(r[numCol] || 0));
          chartOptions = {
              scales: {
                  x: {
                      type: 'time',
                      time: {
                          unit: 'day' // Can be adjusted based on data density (e.g., 'hour', 'month')
                      },
                      title: {
                          display: true,
                          text: labelCol
                      }
                  },
                  y: {
                      title: {
                          display: true,
                          text: numCol
                      }
                  }
              },
               plugins: { // To avoid deprecation warning for scaleLabel
                  title: {
                      display: false
                  }
              }
          };
      } else {
          // Use original labels and values for categorical or numeric x-axis
          labels = rows.map(r=>r[labelCol]);
          values = rows.map(r=>Number(r[numCol]||0));
           chartOptions = {
              scales: {
                  x: {
                       title: {
                          display: true,
                          text: labelCol
                      }
                  },
                  y: {
                      title: {
                          display: true,
                          text: numCol
                      }
                  }
              },
              plugins: { // To avoid deprecation warning for scaleLabel
                  title: {
                      display: false
                  }
              }
          };
      }
      
      const type = chartType || (values.length>20?'line':'bar');

      if(chart) chart.destroy(); // Always destroy to properly re-initialize with new scale type

      chart = new Chart(chartCtx, {
        type,
        data: {
          labels,
          datasets: [{ label: numCol, data: values }]
        },
        options: chartOptions
      });
      
      // توضيح المحاور
      let axesInfo = document.getElementById('axes-info');
      if(!axesInfo) {
        axesInfo = document.createElement('div');
        axesInfo.id = 'axes-info';
        axesInfo.style = 'text-align:center;margin-top:8px;font-size:.98rem;color:#218c74;font-weight:500;';
        chartCanvas.parentNode.appendChild(axesInfo);
      }
      axesInfo.style.display = '';
      axesInfo.innerHTML = `المحور X: <b>${labelCol}</b> &nbsp; | &nbsp; المحور Y: <b>${numCol}</b>`;
    }

    // استماع لتغيّر اختيارات الرسم البياني (نوع الرسم والمحاور)
    function refreshChartFromControls() {
      if (!lastResults || !lastResults.length) return;
      const cols = Object.keys(lastResults[0] || {});
      if (!cols.length) return;
      chartCanvas.style.display = '';
      const type = (chartTypeSelect && chartTypeSelect.value && chartTypeSelect.value !== 'auto')
        ? chartTypeSelect.value
        : null;
      const xCol = (xAxisSelect && xAxisSelect.value) ? xAxisSelect.value : null;
      const yCol = (yAxisSelect && yAxisSelect.value) ? yAxisSelect.value : null;
      updateChart(lastResults, type, xCol, yCol);
      let noChartMsg = document.getElementById('no-chart-msg');
      if(noChartMsg) noChartMsg.style.display = 'none';
    }

    if (chartTypeSelect) {
      chartTypeSelect.addEventListener('change', refreshChartFromControls);
    }
    if (xAxisSelect) {
      xAxisSelect.addEventListener('change', refreshChartFromControls);
    }
    if (yAxisSelect) {
      yAxisSelect.addEventListener('change', refreshChartFromControls);
    }
  });
  