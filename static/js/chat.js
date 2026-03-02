document.addEventListener('DOMContentLoaded', () => {
    const box = document.getElementById('chat-box'),
          form = document.getElementById('chat-form'),
          inp = document.getElementById('chat-input'),
          modelSelect = document.getElementById('chat-model-select'),
          clearBtn = document.getElementById('chat-clear-btn');

    // تحميل قائمة نماذج OpenRouter
    async function loadModels() {
      if (!modelSelect) return;
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

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (!box) return;
        if (box.children.length && !confirm('حذف كل الرسائل والبدء من جديد؟')) return;
        box.innerHTML = '';
      });
    }

    // دالة تحويل Markdown أكثر شمولاً (bold/italic/code/lists/links)
    function convertMarkdownToHtml(md) {
      if(!md) return '';
      let html = md;

      // Escape HTML characters to prevent XSS and issues with rendering
      html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      // Handle code blocks (basic - assumes fenced code blocks ```...```)
      html = html.replace(/```([^\n]+)?\n([\s\S]+?)```/g, (match, lang, code) => {
          // lang is captured but not used for simplicity
          return '<pre><code>' + code.trim() + '</code></pre>';
      });

      // Handle inline code `...`
      html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

      // Handle bold **...** or __...__
      html = html.replace(/\*\*(.+?)\*\*|__(.+?)__/g, '<b>$1$2</b>');

      // Handle italic *...* or _..._
      html = html.replace(/\*(.+?)\*|_(.+?)_/g, '<i>$1$2</i>');

      // Handle numbered lists (basic - assumes start of line)
      html = html.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<p>$1. $2</p>'); // Convert list items to paragraphs for now

      // Handle bullet points (basic - assumes start of line)
      html = html.replace(/^\s*[-*+]\s+(.+)$/gm, '<p>• $1</p>'); // Convert list items to paragraphs for now, using a bullet symbol

      // Basic number formatting (add comma for thousands) - Keep this for clarity
      html = html.replace(/\b(\d{4,})\b/g, (match) => {
          return parseFloat(match).toLocaleString('en-US');
      });

      // Convert newlines to <br> for basic formatting (optional, but helps with lists converted to paragraphs)
      html = html.replace(/\n/g, '<br>');

      return html;
    }

    const addMsg = (txt, cls) => {
      const d = document.createElement('div');
      d.className = 'msg ' + cls;
      d.dir = 'rtl'; // Ensure RTL direction
      d.innerHTML = convertMarkdownToHtml(txt); // Use the new function
      box.appendChild(d);
      box.scrollTop = box.scrollHeight;
      return d;
    };

    form.onsubmit = async e => {
      e.preventDefault();
      const txt = inp.value.trim();
      if (!txt) return;
      // Add user message immediately without markdown conversion
      const userMsgDiv = document.createElement('div');
      userMsgDiv.className = 'msg user';
      userMsgDiv.dir = 'rtl'; // Ensure RTL direction for user message
      userMsgDiv.innerText = txt; // Use innerText for user input to avoid XSS
      box.appendChild(userMsgDiv);
      box.scrollTop = box.scrollHeight;
      inp.value = '';

      // streaming
      const d = addMsg('', 'assistant'); // Initial assistant message div

      const model = (modelSelect && modelSelect.value) ? modelSelect.value : 'openai/gpt-4o';
      const r = await fetch('/api/chat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ message: txt, model: model })
      });
      if(r.body && window.ReadableStream){
        const reader = r.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false, full = '';
        let displayLen = 0;
        const WORD_DELAY = 35;
        let wordTimeout = null;
        function flushWordByWord() {
          if (displayLen >= full.length) return;
          const segment = full.slice(0, displayLen + 1);
          const nextSpace = full.indexOf(' ', displayLen + 1);
          const nextNewline = full.indexOf('\n', displayLen + 1);
          let next = displayLen + 1;
          if (nextSpace !== -1 && nextSpace < displayLen + 15) next = nextSpace + 1;
          else if (nextNewline !== -1 && nextNewline < displayLen + 15) next = nextNewline + 1;
          else if (full.length - displayLen > 8) next = Math.min(displayLen + 4, full.length);
          displayLen = next;
          d.innerHTML = convertMarkdownToHtml(full.slice(0, displayLen));
          box.scrollTop = box.scrollHeight;
          if (displayLen < full.length) wordTimeout = setTimeout(flushWordByWord, WORD_DELAY);
        }
        while(!done){
          const {value, done:doneReading} = await reader.read();
          done = doneReading;
          if(value){
            const chunk = decoder.decode(value, {stream:!done});
            full += chunk;
            if (!wordTimeout) wordTimeout = setTimeout(flushWordByWord, WORD_DELAY);
          }
        }
        while (displayLen < full.length) {
          await new Promise(r => setTimeout(r, WORD_DELAY));
          displayLen = full.length;
          d.innerHTML = convertMarkdownToHtml(full);
          box.scrollTop = box.scrollHeight;
        }
        if (wordTimeout) clearTimeout(wordTimeout);
      } else {
        // Fallback for non-streaming or non-ReadableStream browsers
        const { reply } = await r.json();
        d.innerHTML = convertMarkdownToHtml(reply); // Update with converted HTML
      }
    };
  });
  