import {spawnSync} from 'node:child_process';
const docker=spawnSync('docker',['version','--format','{{.Server.Version}}'],{encoding:'utf8',timeout:5000});
if(docker.error||docker.status!==0){console.error('NOT RUN: integration tests require a real Docker server. No integration pass is claimed.');process.exit(2);}
if(process.getuid?.()===0){console.error('NOT RUN: run integration as the dedicated non-root user with rootless Docker.');process.exit(2);}
for(const key of ['SCAN_HELPER_IMAGE','SCAN_PROXY_IMAGE','SCAN_INTEGRATION_IMAGE','SCAN_INTEGRATION_REDIS_URL'])if(!process.env[key]){console.error('NOT RUN: build images, configure and start Redis; required integration environment is missing.');process.exit(2);}
const r=spawnSync(process.execPath,['--import','tsx','--test','services/scan-service/integration/runtime.integration.ts'],{stdio:'inherit',env:process.env});process.exit(r.status??1);
