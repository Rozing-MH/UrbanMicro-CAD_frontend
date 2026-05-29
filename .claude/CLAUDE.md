# UrbanMicro-CAD Frontend

> 本文件继承全局 `D:\DevelopmentProducts\UrbanMicro-CAD\.claude\CLAUDE.md`，补充前端特有规则。

## 技术栈

- Vue 3.4 + TypeScript 5.3 + Vite 5
- Pinia 状态管理
- Three.js 0.160 — 3D 路网渲染
- Comlink + Web Workers — 几何计算与仿真
- bezier-js — 曲线数学
- clipper-lib — 多边形裁剪
- d3-delaunay — Delaunay 三角剖分

## 目录职责

```
src/
├── api/           REST API 客户端（axios）
├── adapters/      第三方库适配层（Clipper2D, Delaunay, BezierJs）
├── commands/      用户操作命令（可撤销/重做）
├── composables/   Vue 组合式函数
├── services/      纯业务逻辑（不依赖 Vue）
├── stores/        Pinia 状态管理
├── types/         TypeScript 类型定义
├── utils/         工具函数（roadProfiles, roadGeometry）
├── workers/       Web Worker（geometry, simulation）
├── components/
│   ├── panels/    左侧资产、右侧属性、底部时间轴面板
│   ├── toolbar/   顶部工具栏
│   └── viewport/  Three.js 主视口
├── views/         页面视图（Dashboard, Editor, Login）
├── router/        Vue Router
└── styles/        CSS（tokens, base）
```

## 编码规则

### Command 模式
- 所有用户可撤销操作必须走 `HistoryStack.execute(command)`
- 命令在 `commands/` 目录下，文件名 `{动词}{名词}Command.ts`
- 新命令必须在 `commands/index.ts` 统一导出
- 详见全局规则 `rules/urbanmicro/command-pattern.md`

### Three.js
- Three 对象用 `shallowRef`，禁止 `ref`/`reactive` 包裹
- Geometry/Material/Texture 必须 `dispose`
- 预览资源在 `clearPreview()` 中统一释放
- 模块级复用共享 Geometry 实例
- 详见全局规则 `rules/urbanmicro/three-js.md`

### Store
- 状态变更只通过 Pinia action，禁止直接赋值
- 序列化格式对齐设计文档（topologyData + ruleData + odConfig）
- 旧数据兼容读取，新保存使用文档格式

### 视口交互
- 工具交互在 `ThreeViewport.vue` 中实现
- 工具切换时清理临时状态（锚点 mesh、预览 mesh、选中高亮）
- `onBeforeUnmount` 清理所有 Three 资源和事件监听

## 构建与验证

```bash
npm run type-check   # vue-tsc --noEmit
npm run build        # vue-tsc --noEmit && vite build
npm run dev          # vite 开发服务器
```

## 当前版本

基于变更日志最新版本号，每次变更 0.0.1 递增。
