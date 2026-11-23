"""Train and export a five-date spectral CNN-LSTM on independent simulated histories."""
from pathlib import Path
import json
import numpy as np
import torch
from torch import nn


def histories(rng,count):
    time=np.arange(6)[None,:]
    level=rng.uniform(.25,.76,(count,1))
    trend=rng.uniform(-.055,.04,(count,1))
    ndvi=np.clip(level+time*trend+.012*np.sin(rng.uniform(0,6,(count,1))+time)
                 +rng.normal(0,.009,(count,6)),.06,.89)
    power=rng.uniform(.62,.85,(count,1))+rng.normal(0,.016,(count,6))
    bands=np.stack([power*(1-ndvi)/2,power*(1+ndvi)/2],axis=2)
    return torch.tensor(bands[:,:5],dtype=torch.float32),torch.tensor(ndvi[:,5],dtype=torch.float32)


class SpectralNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv=nn.Conv1d(2,6,2)
        self.lstm=nn.LSTM(6,8,batch_first=True)
        self.out=nn.Linear(8,1)

    def forward(self,bands):
        x=torch.tanh(self.conv(((bands-.4)*4).transpose(1,2))).transpose(1,2)
        h,_=self.lstm(x)
        return self.out(h[:,-1]).squeeze(-1)


def main():
    torch.manual_seed(76)
    torch.set_num_threads(2)
    rng=np.random.default_rng(388)
    train,y=histories(rng,3072)
    val,v=histories(rng,384)
    net=SpectralNet()
    opt=torch.optim.Adam(net.parameters(),lr=.007)
    for epoch in range(38):
        for ids in torch.randperm(len(y)).split(128):
            opt.zero_grad()
            loss=torch.nn.functional.mse_loss(net(train[ids]),y[ids])
            loss.backward()
            opt.step()
    with torch.no_grad():
        ref=(val[:,-1,1]-val[:,-1,0])/(val[:,-1,1]+val[:,-1,0])
        scores={"train":len(train),"val":len(val),"mae":float((net(val)-v).abs().mean()),
                "persistenceMae":float((ref-v).abs().mean())}
        spec={k:p.numpy().round(7).tolist() for k,p in net.state_dict().items()}
        spec["metrics"]=scores
        spec["reference"]={"bands":val[0].tolist(),"expected":float(net(val[:1])[0])}
    out=Path(__file__).resolve().parents[1]/"dist"/"lab-weights.js"
    out.write_text("const SpectralWeights = "+json.dumps(spec,separators=(",",":"))+
                   ";\nif (typeof module!=='undefined' && module.exports) module.exports = SpectralWeights;\n")
    print(scores,flush=True)


if __name__=="__main__":
    main()
