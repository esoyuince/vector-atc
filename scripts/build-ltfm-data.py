"""Rebuild the frozen simulator subset offline; default to checking, never overwrite source."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def read_inputs(folder: Path) -> dict[str, str]:
    sources = {r['name']: r for r in json.loads((ROOT / 'docs/data-sources.json').read_text(encoding='utf-8'))}
    inputs = json.loads((ROOT / 'docs/generator-text-inputs.json').read_text(encoding='utf-8'))['inputs']
    texts = {}
    for item in inputs:
        name, stem = item['name'], item['sourceId']
        expected = sources[name]
        pdf = (folder / (name + '.pdf')).read_bytes()
        if len(pdf) != expected['bytes'] or hashlib.sha256(pdf).hexdigest() != expected['sha256']:
            raise ValueError('Frozen source PDF mismatch: ' + stem)
        text = (folder / (name + '.txt')).read_text(encoding='utf-8')
        if hashlib.sha256(text.encode('utf-8')).hexdigest() != item['textSha256']:
            raise ValueError('Frozen source text mismatch: ' + stem)
        texts[stem] = text
    return texts

def build_data(folder: Path) -> dict:
    texts = read_inputs(folder)
    fixes={}
    def dms(s):
     parts=re.findall(r'\d+(?:\.\d+)?',s);return round(float(parts[0])+float(parts[1])/60+float(parts[2])/3600,8)
    for stem in ['STAR_01_A','SID_01_A','IAC_13','IAC_15','IAC_17']:
     text=texts[stem];text=re.sub(r'\s*:\s*',':',text)
     for name,lat,lon in re.findall(r'\b([A-Z][A-Z0-9]{3,5})\s+(\d\d:\d\d:[\d.]+N)\s+(\d{3}:\d\d:[\d.]+E)',text):fixes[name]={'lat':dms(lat),'lon':dms(lon),'source':stem}
     for lat,lon,name in re.findall(r'(\d\d:\d\d:[\d.]+N)\s+(\d{3}:\d\d:[\d.]+E)([A-Z][A-Z0-9]{3,5})',text):fixes[name]={'lat':dms(lat),'lon':dms(lon),'source':stem}
    # Compact coordinates in profile labels, visually checked on IAC13/15.
    for name,lat,lon,src in [('NEDBA','41:26:31.25N','028:42:14.10E','IAC_13'),('MIVPA','41:22:55.14N','028:42:18.37E','IAC_13'),('ELNIN','41:29:44.18N','028:43:23.58E','IAC_15'),('LADUX','41:26:32.06N','028:43:27.32E','IAC_15'),('ATBES','41:22:55.95N','028:43:31.51E','IAC_15'),('FM165','41:14:42.52N','028:27:42.92E','IAC_13'),('FM166','41:27:49.58N','028:17:24.99E','IAC_13')]:fixes[name]={'lat':dms(lat),'lon':dms(lon),'source':src}
    runways=[]
    for id,op,lat,lon,endlat,endlon,elev,length,active in [('16R','34L','41:17:54.97N','028:42:24.31E','41:15:53.45N','028:42:26.71E',219,3750,True),('16L','34R','41:17:55.07N','028:42:33.33E','41:15:53.55N','028:42:35.73E',218,3750,False),('17R','35L','41:17:55.69N','028:43:28.33E','41:15:42.82N','028:43:30.92E',202,4100,False),('17L','35R','41:17:55.79N','028:43:37.36E','41:15:42.92N','028:43:39.94E',202,4100,True),('18','36','41:17:23.25N','028:45:22.24E','41:15:44.08N','028:45:24.12E',221,3060,True)]:
     runways.append(dict(id=id,opposite=op,lat=dms(lat),lon=dms(lon),endLat=dms(endlat),endLon=dms(endlon),elevation=elev,lengthM=length,headingTrue=179.15,active=active,source='AD_2.12'))
    procedures={}
    def proc(id,kind,seq,constraints=None,**extra):
     constraints=constraints or {}
     for f in seq:
      assert f in fixes,(id,f)
     procedures[id]=dict(id=id,kind=kind,legs=[dict(fix=f,**constraints.get(f,{})) for f in seq],**extra)
    common='FM458 FM510 FM511 FM512 FM513 FM514 FM515 FM516 GAZGE'.split()
    constraints={'RIXEN':dict(maxAltitude=19000,speed=250),'FM966':dict(minAltitude=14000,maxAltitude=16000),'FM458':dict(altitude=10000,speed=230),'FM514':dict(altitude=10000),'GAZGE':dict(minAltitude=4000,maxAltitude=5000,speed=220)}
    proc('RIXEN1P','STAR',['RIXEN','FM966','FM967']+common,constraints,source='STAR_01')
    constraints2={**constraints,'EPEKI':dict(maxAltitude=28000,speed=280),'FM450':dict(maxAltitude=26000),'FM644':dict(speed=250),'FM456':dict(minAltitude=12000,maxAltitude=14000)}
    proc('ERSEN1R','STAR','ERSEN FM551 EPEKI FM641 FM450 FM642 FM643 FM644 FM645 FM456 FM457'.split()+common,constraints2,source='STAR_01')
    for runway,suffix,prefix,climb,turnmin,firstmin in [('16R','F','FM047 FM048 FM049 FM061',4000,900,2100),('17L','G','FM051 FM060 REDGI FM061',5000,760,1800),('18','H','FM072 FM073 HANCI FM061',8000,760,2030)]:
     for dest in ['TUDBU','VADEN']:
      seq=prefix.split()+'FM062 FM063 FM064 FM065'.split()+(['FM066'] if dest=='VADEN' else [])+[dest]
      proc(dest+'1'+suffix,'SID',seq,{seq[0]:dict(minAltitude=firstmin,maxSpeed=250)},runway=runway,initialClimb=climb,minTurnAltitude=turnmin,minClimbFtPerNm=304,climbGradientUntil=8000,source='SID_01_A',gradientSource='SID_01')
    # ILS Z transitions, profile fixes and go-arounds, checked visually in IAC13/15/17.
    apps={
     '16R':{'GAZGE':'GAZGE RUQFE FIFAW SAMHI','INSTA':'INSTA UZAZE OLHIM SAMHI','ULQAL':'ULQAL RUQFE FIFAW SAMHI'},
     '17L':{'GAZGE':'GAZGE BEBJE ILCEH EFQER','INSTA':'INSTA IZQEP NOQAW EFQER','ULQAL':'ULQAL FIFAW NOQAW EFQER'},
     '18':{'GAZGE':'GAZGE YOYOC OMHET FUDDI','INSTA':'INSTA GITVO OZNUQ FUDDI','ULQAL':'ULQAL OMHET FUDDI'}}
    for r in runways:
     if not r['active']:continue
     runway=r['id'];src={'16R':'IAC_13','17L':'IAC_15','18':'IAC_17'}[runway]
     profile={'16R':'NEDBA MIVPA','17L':'USROF ELNIN LADUX ATBES','18':'AVTEQ ISSIZ EZGEC'}[runway].split()
     r['fap']=profile[0];r['intercept']={'16R':'SAMHI','17L':'EFQER','18':'FUDDI'}[runway]
     fix='THR_'+runway;fixes[fix]=dict(lat=r['lat'],lon=r['lon'],source='AD_2.12')
     cc={'GAZGE':dict(minAltitude=4000,maxAltitude=5000,speed=220),'INSTA':dict(minAltitude=4000,maxAltitude=5000,speed=220),'ULQAL':dict(minAltitude=6000,maxAltitude=7000,speed=220),'FIFAW':dict(altitude=5000),'UZAZE':dict(minAltitude=3000),'OLHIM':dict(speed=210),'SAMHI':dict(altitude=3000,speed=205),'NEDBA':dict(altitude=3000,speed=180),'MIVPA':dict(altitude=1870,speed=160),'NOQAW':dict(altitude=5000,speed=210),'EFQER':dict(altitude=5000,speed=210),'USROF':dict(altitude=5000,speed=205),'ELNIN':dict(altitude=4000,speed=195),'LADUX':dict(altitude=3000,speed=180),'ATBES':dict(altitude=1850,speed=160),'OMHET':dict(altitude=4000),'FUDDI':dict(altitude=4000,speed=210),'AVTEQ':dict(altitude=4000,speed=195),'ISSIZ':dict(altitude=3000,speed=180),'EZGEC':dict(altitude=1870,speed=160)}
     if runway=='17L':cc['GAZGE']=cc['INSTA']=dict(altitude=5000,speed=220)
     for entry,prefix in apps[runway].items():proc('ILS_'+runway+'_'+entry,'APP',prefix.split()+profile+[fix],cc,runway=runway,glideAngle=3,fap=profile[0],source=src)
    for runway,seq,alt,turnmin,hold in [('16R','FM165 FM166',3000,900,'FM166'),('17L','NASVU ERWAZ IRDED',5000,0,'IRDED'),('18','DIKIZ TIBNU',4000,0,'TIBNU')]:
     proc('MISSED_'+runway,'MISSED',seq.split(),{hold:dict(altitude=alt,maxSpeed=230)},runway=runway,initialClimb=alt,minTurnAltitude=turnmin,maxSpeed=230,source={'16R':'IAC_13','17L':'IAC_15','18':'IAC_17'}[runway],hold=hold)
    holds=[dict(fix=n,inboundMag=h,turn=turn,minAltitude=alt,source=src,legSeconds=60,legTimeIsDemoAssumption=True) for n,h,turn,alt,src in [('GAZGE',266,'R',4000,'IAC_13'),('INSTA',66,'L',4000,'IAC_13'),('ULQAL',157,'R',5000,'IAC_13'),('FM166',53,'R',3000,'IAC_13'),('IRDED',252,'R',5000,'IAC_15'),('TIBNU',160,'L',4000,'IAC_17')]]
    for h in holds:
     if h['fix'] in ['FM166','IRDED','TIBNU']:h['maxSpeed']=230
    manifest=json.loads((ROOT/'docs/data-sources.json').read_text(encoding='utf-8'));dates={'AD_2.12':'2026-08-06','STAR_01':'2025-06-12','STAR_01_A':'2025-05-15','SID_01':'2026-05-14','SID_01_A':'2026-05-14','IAC_13':'2025-06-12','IAC_15':'2025-06-12','IAC_17':'2026-08-06'}
    sources=[]
    for key,date in dates.items():
     name='LT_AD_2_LTFM_'+key+'_en' if key!='AD_2.12' else 'LT_AD_2_LTFM_en';m=next(x for x in manifest if x['name']==name);sources.append(dict(id=key,date=date,url=m['url'],sha256=m['sha256']))
    data=dict(id='LTFM-SOUTH-v3',retrieved='2026-09-17',name='Istanbul Airport',icao='LTFM',arp=[dms('41:16:31N'),dms('028:45:07E')],variation=6.1,transitionAltitude=12000,sectorRadiusNm=110,runways=runways,fixes=fixes,procedures=procedures,holds=holds,sources=sources)
    return data

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', type=Path, default=ROOT / 'design/ltfm-sources')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Compare with the tracked dataset (default).')
    mode.add_argument('--output', type=Path, help='Write a NEW candidate file outside the repository.')
    args = parser.parse_args()
    if args.output:
        target = args.output.resolve()
        if target == ROOT or ROOT in target.parents:
            parser.error('Output must be outside the source repository; no in-place regeneration.')
        if target.exists():
            parser.error('Refusing to overwrite an existing candidate.')
    generated = build_data(args.sources.resolve())
    if args.output:
        with target.open('x', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(generated, indent=2, ensure_ascii=False) + '\n')
    else:
        current = json.loads((ROOT / 'src/ltfm-data.json').read_text(encoding='utf-8'))
        if current != generated:
            raise ValueError('Generated data differs; write an external candidate and review the exact diff.')
    print(json.dumps({'verified': True, 'dataset': generated['id'], 'checkOnly': not bool(args.output),
                      'procedures': len(generated['procedures']), 'providerCalls': 0}))

if __name__ == '__main__':
    main()
