"""Rebuild the close-up rice-camera detector from reproducible synthetic frames.

Example: python tools/train-crops.py C:/temp/AgroOculus-crops
Training needs torch, torchvision, ultralytics and opencv-python. Runtime needs only JS.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess

import cv2
import numpy as np
import torch
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parents[1]


def weights(conv):
    # Float16 is used only for storage; browser convolutions accumulate in float32.
    w = conv.weight.detach().cpu().numpy().astype("<f2")
    return {"shape": list(w.shape), "stride": conv.stride[0],
            "w": base64.b64encode(w.tobytes()).decode(),
            "b": conv.bias.detach().cpu().tolist()}


def export(model, output, scores, comparisons):
    net = model.model.float().fuse(verbose=False)
    conv = lambda block: weights(block.conv)
    backbone = []
    for layer in net.model[:-1]:
        if hasattr(layer, "m"):
            backbone.append({"type":"c2f", "cv1":conv(layer.cv1), "cv2":conv(layer.cv2),
                             "residuals":[[conv(b.cv1),conv(b.cv2)] for b in layer.m]})
        else:
            backbone.append({"type":"conv", "cv":conv(layer)})
    head = net.model[-1]
    def branch(block):
        return [conv(block[0]),conv(block[1]),weights(block[2])]
    spec = {"size":64,"regMax":head.reg_max,"labels":["crop_stress","pump_house"],"backbone":backbone,
            "box":branch(head.cv2[0]),"cls":branch(head.cv3[0]),"metrics":scores,
            "reference":comparisons}
    output.write_text("const CropYoloWeights = "+json.dumps(spec,separators=(",",":"))+
                      ";\nif (typeof module !== 'undefined' && module.exports) module.exports = CropYoloWeights;\n")


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--epochs",type=int,default=55)
    parser.add_argument("--weights",type=Path)
    args=parser.parse_args()
    folder=args.directory.resolve()
    subprocess.run(["node",str(ROOT/"tools"/"crop-dataset.cjs"),str(folder)],check=True)
    for file in folder.glob("images/*/*.ppm"):
        rgb=cv2.imread(str(file))
        cv2.imwrite(str(file.with_suffix(".png")),cv2.resize(rgb,(64,64),interpolation=cv2.INTER_AREA))
        file.unlink()
    data=folder/"data.yaml"
    data.write_text(f"path: '{folder.as_posix()}'\ntrain: images/train\nval: images/val\nnames: [crop_stress, pump_house]\n")
    if not args.weights:
        trainer=YOLO(str(ROOT/"tools"/"crop-yolov8.yaml"))
        trainer.train(data=str(data),imgsz=64,epochs=args.epochs,batch=32,workers=0,device="cpu",
                      cache="ram",amp=False,pretrained=False,optimizer="AdamW",lr0=.004,
                      warmup_epochs=1,weight_decay=.0003,seed=29,patience=0,
                      hsv_h=0,hsv_s=.08,hsv_v=.1,translate=.12,scale=.35,mosaic=0,fliplr=.5,
                      project=str(folder/"runs"),name="train",exist_ok=True,plots=False,
                      save=True,verbose=False)
        args.weights=folder/"runs/train/weights/best.pt"
    model=YOLO(str(args.weights))
    report=model.val(data=str(data),imgsz=64,rect=False,batch=32,workers=0,device="cpu",plots=False,
                     project=str(folder/"runs"),name="evaluation",exist_ok=True)
    padded=model.val(data=str(data),imgsz=64,rect=True,batch=32,workers=0,device="cpu",plots=False,
                     project=str(folder/"runs"),name="evaluation-padded",exist_ok=True)
    scores={"train":320,"val":96,"map50":float(report.box.map50),"map50_95":float(report.box.map),
            "paddedMap50":float(padded.box.map50),"paddedMap50_95":float(padded.box.map)}
    comparisons={}
    for i in (1,2):
        result=model.predict(folder/f"images/val/{i:04d}.png",imgsz=64,verbose=False)[0]
        comparisons[i]=[{"classId":int(b.cls.item()),"xyxy":b.xyxyn[0].tolist(),
                         "confidence":float(b.conf.item())} for b in result.boxes]
    export(model,ROOT/"dist"/"lab-yolo.js",scores,comparisons)
    print(scores,flush=True)


if __name__=="__main__":
    os.environ.setdefault("YOLO_OFFLINE","true")
    torch.set_num_threads(3)
    main()
