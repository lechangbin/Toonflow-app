<p>
  <a href="https://github.com/HBAI-Ltd/Toonflow-app">
    <img src="https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white" alt="GitHub" />
  </a>
  &nbsp;|&nbsp;
  <a href="https://gitee.com/HBAI-Ltd/Toonflow-app">
    <img src="https://img.shields.io/badge/Gitee-C71D23?style=flat-square&logo=gitee&logoColor=white" alt="Gitee" />
  </a>
  &nbsp;|&nbsp;
  <a href="https://gitcode.com/HBAI-Ltd/Toonflow-app">
    <img src="./atomgitLogo.png" alt="Atomgit" style="height:16px"/>
    Atomgit
  </a>
</p>

<p align="center">
  <a href="/README.md">简体中文</a> | 
  <a href="./README.zhtw.md">繁體中文</a> | 
  <strong>English</strong> | 
  <a href="./README.th.md">ไทย</a> | 
  <a href="./README.vi.md">Tiếng Việt</a> | 
  <a href="./README.jp.md">日本語</a> | 
  <a href="./README.ru.md">Русский</a>
</p>

<div align="center">

<img src="./logo.png" alt="Toonflow Logo" height="120"/>

# Toonflow

  <p align="center">
    <b>
      AI Short Drama Factory
      <br />
      With a tap, novels instantly become episodes!
      <br />
      AI scripts × AI visuals × Turbo generation 🔥
    </b>
  </p>
  <p align="center">
    <a href="https://github.com/HBAI-Ltd/Toonflow-app/stargazers">
      <img src="https://img.shields.io/github/stars/HBAI-Ltd/Toonflow-app?style=for-the-badge&logo=github" alt="Stars Badge" />
    </a>
    <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank">
      <img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=for-the-badge" alt="Apache-2.0 License Badge" />
    </a>
    <a href="https://github.com/HBAI-Ltd/Toonflow-app/releases">
      <img alt="release" src="https://img.shields.io/github/v/release/HBAI-Ltd/Toonflow-app?style=for-the-badge" />
    </a>
  </p>
  
  > 🚀 **One-stop short drama production**: From text to characters, from storyboard to video, 0 barrier full-process AI, 10x+ creation efficiency!
</div>

---

# 🌟 Main Features

Toonflow is an AI short drama comic tool that leverages AI technology to automatically convert novels into scripts, and uses AI-generated images and videos for efficient short drama creation. With Toonflow, you can easily complete the entire process from text to images, making short drama production more intelligent and convenient.

- ✅ **Character Generation**  
   Automatically analyzes the original novel text, intelligently identifies and generates character settings, including appearance, personality, identity, etc., providing a reliable foundation for subsequent script and visual creation.
- ✅ **Script Generation**  
   Based on selected events and chapters, the system automatically generates structured scripts, covering dialogue, scene descriptions, and plot direction, enabling efficient transformation from literary texts to film/TV scripts.
- ✅ **Storyboard Production**  
   Based on the script content, intelligently generates storyboard prompts and visual design, detailing foreground/midground/background, character dynamics, prop settings, and scene layout; automatically turns scripts into storyboards, providing a complete route blueprint for video production.
- ✅ **Video Composition**  
   Integrates AI image and video technologies to generate video clips using AI. Includes online editing and supports personalized output adjustments, making film & TV production collaborative and efficient.

---

# 📦 Application Scenarios

- Short video content creation
- Novel-to-film/TV experiments
- AI literature adaptation tools
- Script development and rapid prototyping
- Video material generation

---

# 🔰 User Guide

## 📺 Video Tutorial

https://www.bilibili.com/video/BV1na6wB6Ea2
[![Toonflow 8-Minute Quick Start AI Video](./videoCover.png)](https://www.bilibili.com/video/BV1na6wB6Ea2)

**Toonflow 8-Minute Quick Start AI Video**
👉 [Click to watch](https://www.bilibili.com/video/BV1na6wB6Ea2/?share_source=copy_web&vd_source=5b718c25439a901a34c7bc0c1d35b38e)

📱 Scan with WeChat on your phone to watch

<img src="./videoQR.png" alt="Scan WeChat to Watch" width="150"/>

---

# 🚀 Installation

## Prerequisites

Before installing and using this software, please prepare the following:

- ✅ Large language model AI service API address
- ✅ Sora or Doubao video service API address
- ✅ Nano Banana Pro image generation model service API

## Local Installation

### 1. Download & Install

| Operating System | GitHub Download                                                | Quark Cloud Download                             | Notes         |
| :--------------: | :------------------------------------------------------------ | :----------------------------------------------- | :------------- |
| Windows         | [Release](https://github.com/HBAI-Ltd/Toonflow-app/releases)   | [Quark Cloud](https://pan.quark.cn/s/94ef07509df0) | Official installer |
|  Linux          | [Release](https://github.com/HBAI-Ltd/Toonflow-app/releases)   | [Quark Cloud](https://pan.quark.cn/s/94ef07509df0) | Official installer |
|  macOS          | [Release](https://github.com/HBAI-Ltd/Toonflow-app/releases)   | [Quark Cloud](https://pan.quark.cn/s/94ef07509df0) | Official installer |

> [!CAUTION]
> On MacOS, please go to Settings - Privacy & Security to configure security settings, otherwise, you may not be able to open the app due to certificate issues.
>
> See Zhihu documentation: [https://www.zhihu.com/question/433389276](https://www.zhihu.com/question/433389276)

> Due to Gitee OS environment and Release file upload size limits, Gitee Release download is currently not available.

### 2. Start Service

After installation, launch the program to start using this service.

> ⚠️ **First-time Login**  
> Username: `admin`  
> Password: `admin123`

## Docker Deployment

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed (version 20.10+)

### Method 1: Online Deployment

To be developed; please use local build for now.

### Method 2: Local Build

Build directly from local source code, suitable for developers or users who have cloned the repo; requires Git installed locally:

```shell
# Clone the project (skip if already cloned)
git clone https://github.com/HBAI-Ltd/Toonflow-app.git
cd Toonflow-app

# Build and start locally with docker-compose
yarn docker:local

# Or build manually
docker build -t toonflow .
docker run -d -p <local_port>:10588 -v <local_data_path>:/app/data toonflow

# After this, the site can be accessed at /web/index.html on the mapped port
# e.g. http://localhost:10588/web/index.html
```

### Service Port Description

| Port     | Purpose       | Deployment Mapping    |
| -------- | ------------ | -------------------- |
| `10588`  | App Interface | `10588:10588`         |

**Environment variable descriptions:**

| Variable      | Description                                 |
| ------------- | ------------------------------------------- |
| `NODE_ENV`    | Environment; `prod` for production          |
| `PORT`        | Service listening port (default 10588)      |
| `OSSURL`      | File storage access address for static files |

---

## Cloud Deployment

### 1. Server Requirements

- **OS:** Ubuntu 20.04+ / CentOS 7+
- **Node.js:** 24.x (recommended, minimum 23.11.1+)
- **RAM:** 2GB+

### 2. Server Deployment

#### 1. Install Environment

```bash
# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 24
# Install Yarn and PM2
npm install -g yarn pm2
```

#### 2. Deploy Project

**Clone from GitHub:**

```bash
cd /opt
git clone https://github.com/HBAI-Ltd/Toonflow-app.git
cd Toonflow-app
yarn install
yarn build
```

**Clone from Gitee (Mainland China recommended):**

```bash
cd /opt
git clone https://gitee.com/HBAI-Ltd/Toonflow-app.git
cd Toonflow-app
yarn install
yarn build
```

#### 3. Configure PM2

Create a `pm2.json` file:

```json
{
  "name": "toonflow-app",
  "script": "data/serve/app.js",
  "instances": "max",
  "exec_mode": "cluster",
  "env": {
    "NODE_ENV": "prod",
    "PORT": 10588,
    "OSSURL": "http://127.0.0.1:10588/"
  }
}
```

**Environment variable descriptions:**

| Variable      | Description                                 |
| ------------- | ------------------------------------------- |
| `NODE_ENV`    | Environment; `prod` for production          |
| `PORT`        | Service listening port                      |
| `OSSURL`      | File storage access address for static files |

---

#### 4. Start Service

```bash
pm2 start pm2.json
pm2 startup
pm2 save
```

#### 5. Common Commands

```bash
pm2 list              # View process list
pm2 logs toonflow-app # View logs
pm2 restart all       # Restart service
pm2 monit             # Monitoring panel
```

> ⚠️ **First-time Login**  
> Username: `admin`  
> Password: `admin123`

#### 6. Deploying the Frontend Website

For standalone frontend deployment or customization, refer to the frontend repository:

- **GitHub**: [Toonflow-web](https://github.com/HBAI-Ltd/Toonflow-web)
- **Gitee**: [Toonflow-web](https://gitee.com/HBAI-Ltd/Toonflow-web)

> 💡 **Note:** This repo already contains a compiled frontend by default. Regular users do NOT need to separately deploy the frontend. The frontend repo is for developers requiring secondary development.

---

# 🔧 Developer Guide

> [!CAUTION]
> 🚧 **PR Submission Guidelines** 🚧
>
> ⛔ `master` branch does NOT accept PRs | ✅ Please submit PRs to the `develop` branch
>
> Developers are invited to co-develop Toonflow. To join, contact owner ACT in the group chat.

## 🛠️ Tech Stack

| Category     | Technology                                                                              |
| ------------ | --------------------------------------------------------------------------------------- |
| Runtime      | Node.js 23.11.1+                                                                        |
| Language     | TypeScript 5.x                                                                          |
| Backend      | Express 5                                                                               |
| Database     | SQLite (better-sqlite3 / knex)                                                          |
| AI Integration | Vercel AI SDK (OpenAI / Anthropic / Google / DeepSeek / Zhipu / MiniMax / Qwen / xAI)|
| Local Inference | @huggingface/transformers (ONNX)                                                     |
| Real-Time    | Socket.IO                                                                               |
| Desktop      | Electron 40                                                                             |
| Image Proc.  | Sharp                                                                                   |
| Container    | Docker                                                                                  |

## Development Environment Preparation

- **Node.js:** version 23.11.1 or above required
- **Yarn:** recommended as the package manager

## Quick Start

1. **Clone the project**

   **Clone from GitHub:**

   ```bash
   git clone https://github.com/HBAI-Ltd/Toonflow-app.git
   cd Toonflow-app
   ```

   **Clone from Gitee (Mainland China recommended):**

   ```bash
   git clone https://gitee.com/HBAI-Ltd/Toonflow-app.git
   cd Toonflow-app
   ```

2. **Install dependencies**

   In the project root directory, install dependencies:

   ```bash
   yarn install
   ```

3. **Start development environment**

   This project includes both **backend API service** and **frontend interface**. Start as needed:

   - **Option 1: Start backend service only**

     ```bash
     yarn dev
     ```

     > ⚠️ This command starts only the backend API (port 10588), **without the web interface**. Accessing `http://localhost:10588` allows API calls only; the full web UI is unavailable. To use the frontend, start the frontend project separately or use GUI mode below.

   - **Option 2: Start Electron desktop client**

     ```bash
     yarn dev:gui
     ```

     > This command starts both backend and Electron window, with built-in web UI. Out-of-the-box, no extra config needed. Recommended for a full experience.

   - **Option 3: Production mode**

     ```bash
     yarn start
     ```

     > Runs compiled service in production mode (requires `yarn build` first).

4. **Build the project**

   - Compile TypeScript files:

     ```bash
     yarn build
     ```

   - Build executable for Windows:

     ```bash
     yarn dist:win
     ```

   - Build executable for Mac:

     ```bash
     yarn dist:mac
     ```

   - Build executable for Linux:

     ```bash
     yarn dist:linux
     ```

5. **Code quality check**

   - Perform lint check:

     ```bash
     yarn lint
     ```

6. **AI Debug panel (Optional)**

   Start the Vercel AI SDK visual debugging tool for easier AI integration debugging:

   ```bash
   yarn debug:ai
   ```

## Frontend Development

To modify the frontend UI, develop in the frontend repository:

- **GitHub**: [Toonflow-web](https://github.com/HBAI-Ltd/Toonflow-web)
- **Gitee**: [Toonflow-web](https://gitee.com/HBAI-Ltd/Toonflow-web)

After frontend build, copy the `dist` contents to this project's `data/web` to integrate.

## Project Structure

```
📂 build/                    # Compiled output
📂 data/                     # Runtime data
│  ├─ 📂 models/            # Local inference models (ONNX)
│  ├─ 📂 oss/               # Object storage (assets/characters/scenes)
│  ├─ 📂 serve/             # Production entry
│  ├─ 📂 skills/            # Agent skill prompts
│  └─ 📂 web/               # Built-in frontend assets
📂 ./                     # Documentation assets
📂 env/                      # Environment configs
📂 scripts/                  # Build and helper scripts
📂 src/
├─ 📂 agents/               # AI Agent modules
│  ├─ 📂 productionAgent/   # Production Agent
│  └─ 📂 scriptAgent/       # Script Agent
├─ 📂 lib/                  # Common libraries (db, responses)
├─ 📂 middleware/           # Middleware
├─ 📂 routes/               # API routes
│  ├─ 📂 agents/            # Agent memory management
│  ├─ 📂 artStyle/          # Art style management
│  ├─ 📂 assets/            # Asset management
│  ├─ 📂 assetsGenerate/    # Asset generation
│  ├─ 📂 cornerScape/       # Storyboard management
│  ├─ 📂 general/           # General APIs
│  ├─ 📂 login/             # Auth
│  ├─ 📂 migrate/           # Data migration
│  ├─ 📂 modelSelect/       # Model selection
│  ├─ 📂 novel/             # Novel management
│  ├─ 📂 other/             # Other features
│  ├─ 📂 production/        # Production management
│  ├─ 📂 project/           # Project management
│  ├─ 📂 script/            # Script generation
│  ├─ 📂 scriptAgent/       # Script Agent APIs
│  ├─ 📂 setting/           # System settings
│  ├─ 📂 task/              # Task management
│  └─ 📂 test/              # Test APIs
├─ 📂 socket/               # WebSocket comms
├─ 📂 types/                # TypeScript types
├─ 📂 utils/                # Utility functions
├─ 📄 app.ts                # App entry point
├─ 📄 core.ts               # Core initialization
├─ 📄 env.ts                # Env vars
├─ 📄 err.ts                # Error handling
├─ 📄 logger.ts             # Logging module
├─ 📄 router.ts             # Route registration
└─ 📄 utils.ts              # General tools
📄 Dockerfile                # Docker build config
📄 electron-builder.yml      # Electron packaging config
📄 skillList.json            # Skills list
📄 LICENSE                   # (Apache-2.0) License
📄 NOTICES.txt               # Third-party dependencies
📄 package.json              # Project config
📄 tsconfig.json             # TypeScript config
```

---

# 🔗 Related Repositories

| Repository        | Description                        | GitHub                                            | Gitee                                             |
| ---------------- | ---------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| **Toonflow-app** | Full client (this repo, for users) | [GitHub](https://github.com/HBAI-Ltd/Toonflow-app)| [Gitee](https://gitee.com/HBAI-Ltd/Toonflow-app)  |
| **Toonflow-web** | Frontend source (for FE devs)      | [GitHub](https://github.com/HBAI-Ltd/Toonflow-web)| [Gitee](https://gitee.com/HBAI-Ltd/Toonflow-web)  |

> 💡 **Tip:** If you just want to use Toonflow, download the client from this repo directly. The frontend repo is for developers needing secondary dev or UI customization.

---

# 👨‍👩‍👧‍👦 WeChat Groups

~~Group 1~~

~~Group 2~~

...

~~Group 10~~

~~Group 11~~

~~Group 12~~

~~Group 13~~

...

~~Group 24~~

Group Assistant:

<img src="./QR.png" alt="Toonflow QR" height="400"/>

---

# 💌 Contact Us

📧 Email: [ltlctools@outlook.com](mailto:ltlctools@outlook.com?subject=Toonflow inquiry)

---

# 📜 License

Toonflow is open source under Apache-2.0 with a supplementary commercial agreement.

License details: https://www.apache.org/licenses/LICENSE-2.0

## Supplementary Agreement

- If you distribute this software as a product to **2 or more independent third parties**, you must obtain **written commercial authorization** from HBAI-Ltd.
- **≤ 5 legal entities** operating jointly for internal use without providing services externally are considered **internal use and require no authorization**.
- You may not remove or modify any trademarks, logos, or copyright notices in Toonflow.

## Always Free — No Authorization Required

- ✅ Using Toonflow to produce content and earn platform revenue shares
- ✅ Secondary development for internal team use
- ✅ ≤ 5 legal entities operating jointly, internally only
- ✅ Personal learning, research, and non-commercial purposes

## Licensing Pricing

| Stage | Annual Revenue | Annual Fee |
|------|---------|------|
| 🌱 Nurture | < $10k | **Free** |
| 🚀 Startup | $10k–$50k | ¥5,000/year |
| 📈 Growth | $50k–$150k | ¥20,000/year |
| 🏢 Scale | $150k–$500k | ¥80,000/year |
| 🌐 Enterprise | > $500k | Negotiable |

> **Non-Retroactivity Clause**: Users who used Toonflow under AGPL-3.0 prior to the v1.0.8 release are not affected by this change. Their existing usage continues under AGPL-3.0.

See the full [LICENSE](../LICENSE) file for details.

---

# ⭐️ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=HBAI-Ltd/Toonflow-app&type=timeline&legend=top-left)](https://www.star-history.com/#HBAI-Ltd/Toonflow-app&type=timeline&legend=top-left)

---

# 🙏 Thanks

Thank you to the following open-source projects for supporting Toonflow:

- [Express](https://expressjs.com/) - Fast, open, minimalist Node.js Web framework
- [AI SDK](https://ai-sdk.dev/) - TypeScript-first AI toolkit
- [Better-SQLite3](https://github.com/WiseLibs/better-sqlite3) - High-performance SQLite3 bindings
- [Sharp](https://sharp.pixelplumbing.com/) - High-performance Node.js image toolkit
- [Axios](https://axios-http.com/) - Promise-based HTTP client
- [Zod](https://zod.dev/) - TypeScript-first schema validation library
- [Socket.IO](https://socket.io/) - Real-time bidirectional event framework
- [Electron](https://www.electronjs.org/) - Cross-platform desktop app framework
- [Hugging Face Transformers](https://huggingface.co./transformers.js) - Local ML inference library

Thanks to the following organizations/individuals for their support:

<table>
  <tr>
    <td>
      <img src="./sponsored/sophnet.png" alt="SophNet Logo" width="48">
    </td>
    <td>
      <b>SophNet Cloud</b> provides computing power sponsorship
      <a href="https://www.sophnet.com/">[Official Website]</a>
    </td>
  </tr>
</table>

For a complete list of third-party dependencies, see `NOTICES.txt`

