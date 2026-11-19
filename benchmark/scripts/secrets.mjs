import {spawnSync} from 'node:child_process';
if(process.env.NODE_ENV==='production'||process.env.BENCHMARK_MODE!=='1'){console.error('Benchmark secrets require BENCHMARK_MODE=1 and are refused in production.');process.exit(2);}
const docker=spawnSync('docker',['version'],{stdio:'ignore',timeout:5000});if(docker.error||docker.status!==0){console.error('NOT RUN: real secrets tool benchmark requires Docker. Fixture parser tests are not a tool execution measurement.');process.exit(2);}
if(!process.env.SCAN_IMAGE_GITLEAKS||!process.env.SCAN_IMAGE_TRUFFLEHOG){console.error('NOT RUN: build the pinned secret images and load images.env first.');process.exit(2);}
const result=spawnSync(process.execPath,['--import','tsx','benchmark/run.ts','--secret-tools',...process.argv.slice(2)],{stdio:'inherit',env:process.env});process.exit(result.status??1);
