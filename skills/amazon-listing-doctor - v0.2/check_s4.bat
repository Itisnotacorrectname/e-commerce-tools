@echo off
cd /d C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor
node -e "var path=require('path');var fs=require('fs');var os=require('os');var WORKSPACE=process.env.OPENCLAW_WORKSPACE||path.join(os.homedir(),'.openclaw','workspace');var cpDir=path.join(WORKSPACE,'amazon-listing-doctor','checkpoints','B0CZPF85JY');var s4=JSON.parse(fs.readFileSync(path.join(cpDir,'step4.json'),'utf8'));console.log('step4 data:',JSON.stringify(s4,null,2));" 2>&1
