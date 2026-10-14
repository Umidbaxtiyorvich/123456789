import torch, soundfile as sf, os, sys
os.makedirs("tts/out", exist_ok=True)
lines = [l.strip() for l in open("tts/lines.txt", encoding="utf-8") if l.strip()]
torch.set_num_threads(4)
imp = torch.package.PackageImporter("v4_uz.pt")
model = imp.load_pickle("tts_models", "model")
print("speakers:", getattr(model, "speakers", None))
for i, t in enumerate(lines):
    a = model.apply_tts(text=t, speaker="dilnavoz", sample_rate=48000)
    sf.write(f"tts/out/s{i}.wav", a.numpy(), 48000)
    print(i, len(a) / 48000)
