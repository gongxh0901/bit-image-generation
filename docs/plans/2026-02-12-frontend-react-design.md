# 前端重构设计文档：React + Vite + Ant Design 5

**日期**: 2026-02-12  
**项目**: 游戏素材生成系统 (Game Asset Generator)  
**范围**: 前端工程化重构（原生 HTML → React 正式工程）

---

## 目录

1. [概述](#1-概述)
2. [技术栈选型](#2-技术栈选型)
3. [项目结构](#3-项目结构)
4. [页面设计](#4-页面设计)
5. [状态管理设计](#5-状态管理设计)
6. [组件详细设计](#6-组件详细设计)
7. [数据流设计](#7-数据流设计)
8. [样式与主题](#8-样式与主题)
9. [实施步骤](#9-实施步骤)

---

## 1. 概述

### 1.1 目标

将现有的单文件 HTML 前端迁移为现代化的 React 工程，实现：
- 专业的三栏布局界面（风格列表 | 生成操作 | 生成结果）
- 独立的路由页面（首页 + 训练中心）
- 完善的暗色主题支持
- 实时 WebSocket 进度展示
- 批量图片下载功能

### 1.2 核心功能模块

| 模块 | 说明 |
|------|------|
| **风格列表** | 左侧栏，显示所有已训练风格，支持选中、显示生成状态 |
| **生成操作区** | 中间栏，配置生成参数（Prompt、参考图、数量），提交生成任务 |
| **生成结果区** | 右侧栏，按风格分组显示历史结果，支持单选/多选/批量下载 |
| **训练中心** | 独立页面，分步表单（基础信息 → 上传素材 → 配置参数 → 提交） |

### 1.3 约束条件

- 保持与现有后端 API 兼容
- 继续支持 WebSocket 实时进度推送
- 暗色主题优先（符合 AI 工具类产品的视觉风格）

---

## 2. 技术栈选型

### 2.1 核心技术

| 层级 | 技术 | 版本 | 选型理由 |
|------|------|------|----------|
| 构建工具 | **Vite** | ^5.x | 极速 HMR、优化的生产构建、TypeScript 开箱即用 |
| 框架 | **React** | ^18.x | Concurrent Features、成熟生态、组件化开发 |
| 语言 | **TypeScript** | ^5.x | 类型安全、IDE 智能提示、减少运行时错误 |
| 路由 | **React Router** | ^6.x | 声明式路由、懒加载支持、与 React 深度集成 |
| 状态管理 | **Zustand** | ^4.x | 轻量级、TypeScript 友好、无样板代码 |
| HTTP 客户端 | **Axios** | ^1.x | 拦截器、请求取消、浏览器兼容性好 |

### 2.2 UI 组件库

| 库 | 用途 | 选型理由 |
|----|------|----------|
| **Ant Design 5** | 基础组件 | 企业级组件、完善的暗色主题、丰富的表单组件 |

### 2.3 工具库

| 库 | 用途 |
|----|------|
| **JSZip** | 多图片批量打包下载 |
| **file-saver** | 浏览器端文件保存 |

---

## 3. 项目结构

```
frontend/                          # 替换现有 frontend 目录
├── src/
│   ├── components/               # 可复用公共组件
│   │   ├── Layout/               # 全局布局（导航栏 + 侧边栏）
│   │   │   ├── index.tsx
│   │   │   ├── Header.tsx        # 顶部导航栏
│   │   │   └── Layout.module.css
│   │   ├── StyleCard/            # 风格卡片组件
│   │   │   ├── index.tsx
│   │   │   └── StyleCard.module.css
│   │   ├── ImageGallery/         # 图片画廊/列表组件
│   │   │   ├── index.tsx
│   │   │   └── ImageGallery.module.css
│   │   └── GenerationProgress/   # 生成进度条组件
│   │       ├── index.tsx
│   │       └── GenerationProgress.module.css
│   │
│   ├── pages/                    # 页面级组件
│   │   ├── Home/                 # 首页（三栏布局）
│   │   │   ├── index.tsx         # 页面入口
│   │   │   ├── Home.module.css
│   │   │   ├── components/
│   │   │   │   ├── StyleList.tsx      # 左侧：风格列表
│   │   │   │   ├── GenerationPanel.tsx # 中间：生成操作区
│   │   │   │   └── ResultGallery.tsx   # 右侧：生成结果
│   │   │   └── hooks/
│   │   │       └── useHomeData.ts     # 首页数据获取逻辑
│   │   │
│   │   └── Training/             # 训练中心页面
│   │       ├── index.tsx
│   │       ├── Training.module.css
│   │       ├── components/
│   │       │   ├── StyleForm.tsx      # 步骤1：基础信息
│   │       │   ├── DatasetUpload.tsx  # 步骤2：素材上传
│   │       │   ├── ParamsForm.tsx     # 步骤3：参数配置
│   │       │   └── TrainingConfirm.tsx # 步骤4：确认提交
│   │       └── hooks/
│   │           └── useTrainingForm.ts  # 表单状态管理
│   │
│   ├── stores/                   # Zustand 状态管理
│   │   ├── index.ts              # Store 聚合导出
│   │   ├── styleStore.ts         # 风格列表状态
│   │   ├── generationStore.ts    # 生成任务状态
│   │   └── trainingStore.ts      # 训练任务状态
│   │
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useWebSocket.ts       # WebSocket 连接管理
│   │   ├── useApi.ts             # API 请求封装
│   │   ├── useGeneration.ts      # 生成任务业务逻辑
│   │   └── useDownload.ts        # 图片下载逻辑
│   │
│   ├── services/                 # API 服务层
│   │   ├── api.ts                # Axios 实例配置
│   │   ├── style.ts              # 风格相关 API
│   │   ├── generation.ts         # 生成相关 API
│   │   └── training.ts           # 训练相关 API
│   │
│   ├── types/                    # TypeScript 类型定义
│   │   ├── index.ts              # 类型聚合导出
│   │   ├── style.ts              # 风格相关类型
│   │   ├── generation.ts         # 生成相关类型
│   │   ├── training.ts           # 训练相关类型
│   │   └── common.ts             # 通用类型
│   │
│   ├── utils/                    # 工具函数
│   │   ├── download.ts           # 图片下载、ZIP 打包
│   │   ├── format.ts             # 格式化工具（时间、大小等）
│   │   └── validators.ts         # 表单验证规则
│   │
│   ├── theme/                    # 主题配置
│   │   ├── index.ts              # 主题导出
│   │   └── darkTheme.ts          # 暗色主题配置
│   │
│   ├── App.tsx                   # 根组件（路由配置）
│   ├── main.tsx                  # 入口文件
│   └── index.css                 # 全局样式
│
├── public/                       # 静态资源
│   └── vite.svg
│
├── index.html                    # HTML 模板
├── package.json                  # 依赖配置
├── tsconfig.json                 # TypeScript 配置
├── tsconfig.node.json            # Node 类型配置
├── vite.config.ts                # Vite 配置
└── README.md                     # 项目说明
```

---

## 4. 页面设计

### 4.1 首页布局（三栏）

```
┌─────────────────────────────────────────────────────────────┐
│  🏠 首页          🎓 训练中心          ⚙️ 设置（预留）         │  ← Header
├──────────┬─────────────────────────────┬────────────────────┤
│          │                             │                    │
│  风格列表  │    生成操作区域              │    生成结果         │
│  ──────── │    ─────────────────         │    ─────────       │
│          │                             │                    │
│  ☑ 风格A  │    [上传参考图区域]           │   ┌──────────┐    │
│          │                             │   │ [图片1]  │ ▼   │
│    风格B  │    Prompt:                  │   └──────────┘    │
│          │    ┌─────────────────┐       │   ┌──────────┐    │
│  ☑ 风格C  │    │ 输入中文提示词... │      │   │ [图片2]  │ ▼   │
│  [生成中] │    └─────────────────┘       │   └──────────┘    │
│          │                             │                    │
│  (点击    │    生成数量: [ 1 ▲▼ ]       │   [全选] [下载选中] │
│   选中)   │                             │   [下载全部]       │
│          │    [ 开始生成 ]               │                    │
│          │                             │                    │
│          │    进度: [████████░░] 80%    │                    │
│          │    状态: 生成中...            │                    │
│          │                             │                    │
└──────────┴─────────────────────────────┴────────────────────┘
   20%               50%                          30%
```

**布局比例**：
- 左侧（风格列表）：`span={5}` (~20%)
- 中间（生成操作）：`span={12}` (~50%)
- 右侧（生成结果）：`span={7}` (~30%)

### 4.2 训练中心页面（分步表单）

```
┌─────────────────────────────────────────────────────────────┐
│  面包屑: 首页 > 训练中心                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────┐  ┌────┐  ┌────┐  ┌────┐                              │
│  │ 1  │→ │ 2  │→ │ 3  │→ │ 4  │   ← Steps 步骤条            │
│  └────┘  └────┘  └────┘  └────┘                              │
│  基础信息   上传素材   配置参数   确认提交                      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [当前步骤内容区域]                                           │
│                                                             │
│  • 风格名称: [________________]                              │
│    提示: 使用中文名称便于识别                                  │
│                                                             │
│  • 数据集: [拖拽上传区域]                                     │
│    提示: 支持 JPG/PNG，建议 10-50 张图片                       │
│                                                             │
│  • 训练参数:                                                 │
│    - 批次大小: [ 1 ▲▼ ] 提示：每步训练使用的图片数量            │
│    - 学习率: [ 0.0001 ▲▼ ] 提示：控制模型更新速度              │
│    - 训练步数: [ 1000 ▲▼ ] 提示：建议 1000-3000 步            │
│    - 分辨率: [ 1024 ▲▼ ] 提示：SDXL 推荐 1024               │
│                                                             │
│  [   上一步   ]          [   下一步   /   开始训练   ]         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 状态管理设计

### 5.1 风格状态 (`styleStore.ts`)

```typescript
interface Style {
  id: number;
  name: string;
  type: 'ui' | 'vfx';
  loraPath?: string;
  triggerWords?: string;
  createdAt: string;
}

interface StyleStore {
  // State
  styles: Style[];
  selectedStyleId: number | null;
  generatingStyleIds: Set<number>;  // 正在生成中的风格ID
  loading: boolean;
  error: string | null;
  
  // Actions
  fetchStyles: () => Promise<void>;
  selectStyle: (id: number) => void;
  setGenerating: (id: number, isGenerating: boolean) => void;
  clearError: () => void;
}
```

**使用场景**：
- 左侧风格列表组件订阅 `styles`、`selectedStyleId`、`generatingStyleIds`
- 生成任务开始时调用 `setGenerating(id, true)` 显示加载状态
- 生成完成时调用 `setGenerating(id, false)` 恢复状态

### 5.2 生成任务状态 (`generationStore.ts`)

```typescript
interface GenerationTask {
  id: number;
  styleId: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  prompt: string;
  outputPaths?: string[];
  createdAt: string;
  updatedAt: string;
}

interface GenerationResult {
  id: number;
  taskId: number;
  imageUrl: string;
  filename: string;
  createdAt: string;
}

interface GenerationStore {
  // State
  currentTask: GenerationTask | null;
  history: Record<number, GenerationResult[]>;  // 按风格ID分组
  selectedImages: Set<string>;  // 当前选中的图片URL
  loading: boolean;
  error: string | null;
  
  // Actions
  submitGeneration: (params: {
    styleId: number;
    prompt: string;
    numImages: number;
    referenceImage?: File;
  }) => Promise<void>;
  
  updateTaskProgress: (progress: {
    id: number;
    status: string;
    progress: number;
    outputPaths?: string[];
  }) => void;
  
  addToHistory: (styleId: number, results: GenerationResult[]) => void;
  
  // 图片选择
  toggleImageSelection: (url: string) => void;
  selectAllImages: (styleId: number) => void;
  clearSelection: () => void;
  
  // 下载
  downloadSelected: () => Promise<void>;
  downloadAll: (styleId: number) => Promise<void>;
}
```

**使用场景**：
- 中间面板订阅 `currentTask` 显示进度
- 右侧结果区订阅 `history[selectedStyleId]` 显示历史
- WebSocket 消息触发 `updateTaskProgress`

### 5.3 训练任务状态 (`trainingStore.ts`)

```typescript
interface TrainingJob {
  id: number;
  styleId: number;
  datasetPath: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  params: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

interface TrainingParams {
  batchSize: number;
  learningRate: number;
  maxTrainSteps: number;
  resolution: number;
  saveEveryNSteps?: number;
}

interface TrainingStore {
  // State
  currentStep: number;  // 0-3
  formData: {
    styleName: string;
    datasetFiles: File[];
    params: TrainingParams;
  };
  activeJobs: TrainingJob[];
  submitting: boolean;
  
  // Actions
  setStep: (step: number) => void;
  updateFormData: (data: Partial<TrainingStore['formData']>) => void;
  submitTraining: () => Promise<void>;
  fetchJobs: () => Promise<void>;
  resetForm: () => void;
}
```

---

## 6. 组件详细设计

### 6.1 StyleList 组件

**职责**：显示风格列表，支持选中、显示生成状态

**Props**：
```typescript
// 从 styleStore 注入，无需外部 props
interface StyleListProps {}
```

**渲染逻辑**：
- 使用 Ant Design `List` 组件
- 每项显示：风格名称、类型标签、生成状态图标
- 选中项高亮（蓝色边框）
- 生成中的项显示 `Spin` 动画和文字标签

**交互**：
- 点击列表项 → 调用 `styleStore.selectStyle(id)`
- 实时显示 `generatingStyleIds` 中的状态

### 6.2 GenerationPanel 组件

**职责**：生成参数配置、提交生成任务、显示进度

**Props**：
```typescript
// 从 store 注入
interface GenerationPanelProps {}
```

**表单字段**：

| 字段 | 组件 | 验证规则 | 说明 |
|------|------|----------|------|
| styleId | 只读显示 | - | 自动填充当前选中的风格ID |
| prompt | TextArea | 必填，最长1000字符 | 中文提示词输入 |
| referenceImage | Upload.Dragger | 可选，限制 JPG/PNG，最大 10MB | 参考图片上传 |
| numImages | InputNumber | 必填，范围 1-10，默认 1 | 生成数量 |

**状态显示**：
- 未选中风格：显示空状态提示「请选择左侧风格」
- 空闲状态：显示表单，「开始生成」按钮可用
- 生成中：禁用表单，显示 `Progress` 进度条和状态文字
- 完成：显示成功提示，恢复表单可用

**交互**：
- 提交表单 → 调用 `generationStore.submitGeneration()`
- WebSocket 进度 → 自动更新进度条

### 6.3 ResultGallery 组件

**职责**：显示生成结果列表，支持选择、预览、下载

**Props**：
```typescript
interface ResultGalleryProps {
  // 从 store 注入
}
```

**布局**：
- 顶部：标题「生成结果 (N)」+ 操作栏
- 中部：Ant Design `Image.PreviewGroup` 图片网格
- 底部：批量操作按钮

**图片卡片**：
- 图片缩略图（点击可预览）
- 复选框（多选模式）
- 悬停显示「下载」按钮
- 右键菜单（下载、删除）

**操作按钮**：
- 「全选」/「取消全选」
- 「下载选中」（打包为 ZIP）
- 「下载全部」

### 6.4 训练中心表单组件

**步骤 1 - StyleForm**：
```typescript
interface StyleFormData {
  name: string;        // 输入框，必填
  type: 'ui' | 'vfx';  // 单选框，默认 'ui'
}
// 提示文字：使用中文名称便于识别
```

**步骤 2 - DatasetUpload**：
```typescript
interface DatasetUploadData {
  files: File[];  // Upload.Dragger 多文件上传
}
// 提示：支持 JPG/PNG，建议 10-50 张图片，分辨率建议 1024x1024
```

**步骤 3 - ParamsForm**：
```typescript
interface ParamsFormData {
  batchSize: number;      // InputNumber，默认 1，范围 1-8
  learningRate: number;   // InputNumber，默认 0.0001
  maxTrainSteps: number;  // InputNumber，默认 1000，范围 100-10000
  resolution: number;     // Select，选项：512/768/1024，默认 1024
  saveEveryNSteps: number; // InputNumber，默认 500
}
```

**字段中文提示**：
- 批次大小：「每步训练使用的图片数量，建议 1-4」
- 学习率：「控制模型更新速度，默认 0.0001」
- 训练步数：「训练总轮次，建议 1000-3000」
- 分辨率：「图片训练尺寸，SDXL 推荐 1024」

---

## 7. 数据流设计

### 7.1 WebSocket 消息处理

```typescript
// 全局单例 WebSocket 连接
class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  
  connect() {
    this.ws = new WebSocket('ws://localhost:8000/ws/progress');
    this.ws.onmessage = this.handleMessage;
    this.ws.onclose = this.handleReconnect;
  }
  
  private handleMessage = (event: MessageEvent) => {
    const data = JSON.parse(event.data);
    
    switch (data.kind) {
      case 'generation':
        useGenerationStore.getState().updateTaskProgress(data);
        if (data.status === 'completed') {
          useGenerationStore.getState().addToHistory(data.styleId, data.results);
          useStyleStore.getState().setGenerating(data.styleId, false);
        }
        break;
      case 'training':
        useTrainingStore.getState().updateJobProgress(data);
        break;
    }
  };
}
```

### 7.2 API 调用流程

```
用户操作 → API Service → Axios → 后端
                ↓
           更新 Store → React 组件重渲染
                ↓
           WebSocket 推送 ← 后端异步任务
```

### 7.3 生成任务完整流程

```
1. 用户点击「开始生成」
   ↓
2. GenerationPanel 调用 generationStore.submitGeneration()
   ↓
3. API POST /api/generate 提交任务
   ↓
4. 后端返回 task_id
   ↓
5. Store 设置 currentTask，styleStore 设置 generating
   ↓
6. 组件显示进度条，左侧风格列表显示「生成中」
   ↓
7. WebSocket 推送进度消息
   ↓
8. Store 更新 currentTask.progress
   ↓
9. 进度条实时更新
   ↓
10. WebSocket 推送 completed
    ↓
11. Store 添加结果到 history，清除 generating 状态
    ↓
12. 右侧结果列表更新，显示新图片
```

---

## 8. 样式与主题

### 8.1 暗色主题配置

```typescript
// src/theme/darkTheme.ts
import { theme } from 'antd';

export const darkThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    // 基础颜色
    colorPrimary: '#3b82f6',
    colorSuccess: '#22c55e',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    
    // 背景色
    colorBgContainer: '#1e293b',
    colorBgLayout: '#0f172a',
    colorBgElevated: '#334155',
    
    // 文字色
    colorText: '#e2e8f0',
    colorTextSecondary: '#94a3b8',
    colorTextTertiary: '#64748b',
    
    // 边框
    colorBorder: '#334155',
    colorBorderSecondary: '#475569',
    
    // 圆角
    borderRadius: 8,
    borderRadiusLG: 12,
    
    // 间距
    paddingLG: 24,
    paddingMD: 16,
    paddingSM: 12,
    paddingXS: 8,
  },
  components: {
    Card: {
      colorBgContainer: '#1e293b',
      headerBg: 'transparent',
    },
    Button: {
      borderRadius: 8,
      primaryShadow: '0 2px 0 rgba(0, 0, 0, 0.045)',
    },
    Input: {
      colorBgContainer: '#0f172a',
      activeBg: '#0f172a',
      hoverBg: '#0f172a',
    },
    Select: {
      colorBgContainer: '#0f172a',
    },
    List: {
      colorSplit: '#334155',
    },
    Progress: {
      defaultColor: '#3b82f6',
      remainingColor: '#334155',
    },
  },
};
```

### 8.2 自定义 CSS 变量

```css
/* src/index.css */
:root {
  /* 品牌色 */
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-primary-active: #1d4ed8;
  
  /* 背景 */
  --bg-primary: #0f172a;
  --bg-secondary: #1e293b;
  --bg-tertiary: #334155;
  
  /* 文字 */
  --text-primary: #e2e8f0;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  
  /* 边框 */
  --border-color: #334155;
  --border-color-light: #475569;
  
  /* 间距 */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  
  /* 圆角 */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  
  /* 阴影 */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.5);
}
```

---

## 9. 实施步骤

### 阶段 1：项目初始化
1. 创建 Vite + React + TypeScript 项目
2. 安装依赖：Ant Design、React Router、Zustand、Axios
3. 配置路径别名（`@/components` → `src/components`）
4. 设置暗色主题（ConfigProvider）
5. 配置 ESLint + Prettier

### 阶段 2：基础架构搭建
1. 创建目录结构
2. 实现 API Service 层（封装后端接口）
3. 实现 Zustand Stores（Style、Generation、Training）
4. 实现 WebSocket Hook
5. 配置 React Router（首页、训练中心）

### 阶段 3：首页三栏布局
1. 实现 Layout 组件（顶部导航）
2. 实现 StyleList 组件（左侧栏）
3. 实现 GenerationPanel 组件（中间栏）
4. 实现 ResultGallery 组件（右侧栏）
5. 联调生成流程（WebSocket 进度）

### 阶段 4：训练中心页面
1. 实现 Steps 步骤条导航
2. 实现 StyleForm（基础信息）
3. 实现 DatasetUpload（素材上传）
4. 实现 ParamsForm（参数配置，带中文提示）
5. 实现表单验证和提交

### 阶段 5：功能完善
1. 图片批量下载（JSZip 打包）
2. 图片预览功能
3. 空状态和错误处理
4. 加载状态优化
5. 响应式适配（移动端基础支持）

### 阶段 6：测试与优化
1. 端到端测试生成流程
2. 测试训练提交流程
3. 性能优化（React.memo、useMemo）
4. 构建生产版本并验证

---

## 10. API 接口清单

### 风格管理
- `GET /api/styles` - 获取风格列表
- `POST /api/styles` - 创建风格

### 生成任务
- `POST /api/generate` - 提交生成任务
- `GET /api/tasks` - 获取任务列表

### 训练任务
- `POST /api/training` - 提交训练任务
- `GET /api/training/{id}` - 获取训练任务详情

### WebSocket
- `WS /ws/progress` - 实时进度推送

### 静态文件
- `GET /outputs/{filename}` - 获取生成图片

---

**文档版本**: 1.0  
**作者**: AI Assistant  
**最后更新**: 2026-02-12
