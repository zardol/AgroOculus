"""Apply OpenCV median filtering to one reproducible training frame with known sensor noise."""
import argparse
import base64
import json
from pathlib import Path
import cv2
import numpy as np


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("training_directory",type=Path,help="Dataset created by train-crops.py")
    args=parser.parse_args()
    clean=cv2.imread(str(args.training_directory/"images/train/0007.png"))
    if clean is None: raise ValueError("Missing images/train/0007.png. Generate training data first.")
    rng=np.random.default_rng(178)
    h,w=clean.shape[:2]
    choice=rng.random((h,w))
    noisy=clean.copy()
    noisy[choice<.0625]=0
    noisy[choice>.9375]=255
    filtered=cv2.medianBlur(noisy,3)
    mae=lambda a:float(cv2.absdiff(a,clean).mean())
    encoded=lambda a:base64.b64encode(cv2.cvtColor(a,cv2.COLOR_BGR2RGB).tobytes()).decode("ascii")
    metrics={"sample":"train/0007","size":w,"noisePixels":int(((choice<.0625)|(choice>.9375)).sum()),
             "maeBefore":mae(noisy),"maeAfter":mae(filtered),"kernel":3,"opencv":cv2.__version__}
    data={"metrics":metrics,"before":encoded(noisy),"after":encoded(filtered)}
    target=Path(__file__).resolve().parents[1]/"dist/lab-calibration.js"
    target.write_text("const CameraCalibration = "+json.dumps(data,separators=(",",":"))+
                      ";\nif (typeof module !== 'undefined' && module.exports) module.exports=CameraCalibration;\n")
    print(metrics)


if __name__=="__main__":
    main()
