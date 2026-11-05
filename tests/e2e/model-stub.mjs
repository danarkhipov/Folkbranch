// Stand-in for the model API, scripted by the last thing the person said.
import http from 'node:http'; import fs from 'node:fs'
const LOG=process.env.STUB_LOG??'/tmp/model-stub.log'; fs.writeFileSync(LOG,'')
const FIRST={'кто в костроме':['query_people',{place:'Кострома'}],'добавь':['create_person',{person:{givenName:'Проба',surname:'Агентова',deathDate:'1950'}}],'удали':['delete_person',{id:'__ID__'}],'открой':['focus_person',{id:'__ID__'}],'схема':['set_chart_direction',{rootsBelow:false}],'переименуй':['update_settings',{familyName:'Новые Лесные'}],'пригласи':['create_invite',{name:'Тётя',role:'reader'}],'путь':['show_path',{from:'__ID__',to:'__ID2__'}]}
let ids=['','']
http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{
  if(req.url==='/ids'){ids=JSON.parse(b);res.end('ok');return}
  const j=JSON.parse(b); const last=j.messages.at(-1); const raw=JSON.stringify(j.messages)
  fs.appendFileSync(LOG,raw+'\n')
  res.writeHead(200,{'content-type':'text/event-stream'})
  const ev=(t,d)=>res.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`)
  const u={input_tokens:5,output_tokens:5}
  ev('message_start',{message:{id:'m',type:'message',role:'assistant',model:j.model,content:[],stop_reason:null,usage:u}})
  const text=(s)=>{ev('content_block_start',{index:0,content_block:{type:'text',text:''}});ev('content_block_delta',{index:0,delta:{type:'text_delta',text:s}});ev('content_block_stop',{index:0});ev('message_delta',{delta:{stop_reason:'end_turn'},usage:u});ev('message_stop',{});res.end()}
  const blocks=last.content.map?.(c=>c.type)??[];fs.appendFileSync(LOG+'.types',JSON.stringify(blocks)+'\n');const lastText=(last.content.filter?.(c=>c.type==='text').at(-1)?.text??(typeof last.content==='string'?last.content:'')).toLowerCase()
  const isResult=last.content.some?.(c=>c.type==='tool_result')
  if(isResult) return text('В Костроме родились 5 человек: Николай Соколов, Варвара Соколова и ещё трое.')
  if(lastText.includes('картинк')) return text('Вот: ![x](http://127.0.0.1:3499/leak.png?d=secret) и <img src="http://127.0.0.1:3499/leak2.png"> конец.')
  const key=Object.keys(FIRST).find(k=>lastText.includes(k))
  if(!key) return text('Я ассистент архива. Чем помочь?')
  const [name,input]=FIRST[key]; const s=JSON.stringify(input).replace('__ID__',ids[0]).replace('__ID2__',ids[1])
  ev('content_block_start',{index:0,content_block:{type:'tool_use',id:'tu'+Date.now(),name,input:{}}});ev('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:s}});ev('content_block_stop',{index:0});ev('message_delta',{delta:{stop_reason:'tool_use'},usage:u});ev('message_stop',{});res.end()
})}).listen(3499,'0.0.0.0')
