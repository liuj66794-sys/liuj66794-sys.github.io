import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'
const environment=JSON.parse(fs.readFileSync(process.argv[2],'utf8'))
if(!environment.protection_rules?.some(rule=>rule.type==='required_reviewers'&&rule.reviewers?.some(r=>r.reviewer.login==='liuj66794-sys')))
  throw new Error('Actual operator-required environment reviewer missing')
const manifest=JSON.parse(fs.readFileSync('release-static.json','utf8'))
if(manifest.tier!=='static-recovery'||manifest.sourceSha!==process.env.SOURCE_SHA||!/^[a-f0-9]{40}$/.test(manifest.sourceSha))throw new Error('Reviewed source mismatch')
const root=process.argv[3]||'blog',rows=[]
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  const file=path.join(dir,item.name)
  if(item.isSymbolicLink())throw new Error('Symlink in artifact')
  if(item.isDirectory())walk(file)
  else rows.push([path.relative(root,file).replaceAll('\\','/'),createHash('sha256').update(fs.readFileSync(file)).digest('hex')])
}}walk(root)
const digest=createHash('sha256').update(JSON.stringify(rows)).digest('hex')
if(digest!==manifest.artifactSha256||digest!==process.env.BLOG_SHA256)throw new Error('Artifact hash mismatch')
const {multiuserConfig}=await import('../'+root+'/learning/multiuser-config.mjs')
if(multiuserConfig.auth||multiuserConfig.sync||multiuserConfig.ai)throw new Error('Static release must have all flags OFF')
console.log(JSON.stringify({tier:manifest.tier,sourceSha:manifest.sourceSha,artifactSha256:digest,files:rows.length}))
