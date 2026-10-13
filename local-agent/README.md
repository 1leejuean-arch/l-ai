# L-AI Windows Local Agent

Local Agent는 L-AI 웹 서버와 별도로 사용자 Windows PC에서 실행됩니다. 임의 shell 명령은 받지 않으며 `127.0.0.1:43140`에만 연결됩니다.

두 터미널에 같은 16자 이상의 로컬 토큰을 설정하세요. 저장소에는 토큰을 기록하지 않습니다.

```powershell
# 터미널 1: L-AI 웹
$env:L_AI_LOCAL_AGENT_TOKEN = "여기에-충분히-긴-로컬-토큰"
npm run dev
```

```powershell
# 터미널 2: Windows Local Agent
$env:L_AI_LOCAL_AGENT_TOKEN = "여기에-충분히-긴-로컬-토큰"
npm run local-agent
```

기본 주소를 변경할 때는 Agent 터미널에 `L_AI_LOCAL_AGENT_PORT`, 웹 터미널에 같은 포트를 가리키는 `L_AI_LOCAL_AGENT_URL`을 설정해야 합니다. URL은 `http://127.0.0.1:<port>` 또는 `http://localhost:<port>`만 허용됩니다.

파일 검색과 조작은 Desktop, Documents, Downloads, Pictures, Videos, Music, 현재 L-AI 프로젝트 폴더로 제한됩니다. `.git`, `.env*`, 자격 증명 폴더, 시스템 폴더 및 실행 파일은 보호됩니다.
