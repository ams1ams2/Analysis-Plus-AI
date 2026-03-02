from transformers import AutoTokenizer, AutoModelForCausalLM

model_id = r"D:\LLM\Llama-2-7b-hf"  # تحتاج موافقة من Hugging Face

# تحميل التوكنايزر والنموذج
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    device_map="auto",         # استخدام GPU تلقائيًا إن وجد
    torch_dtype="auto"         # استخدام FP16/BF16 تلقائيًا عند الإمكان
)

# مثال على الإدخال
prompt = "اشرح باختصار مفهوم التعلم العميق."
inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

# توليد الإخراج
outputs = model.generate(**inputs, max_new_tokens=100, temperature=0.7)
response = tokenizer.decode(outputs[0], skip_special_tokens=True)

print(response)
