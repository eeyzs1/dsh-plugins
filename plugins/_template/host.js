return {
  apply(ctx) {
    // 读可选服务用 ctx.get('名字') 并判空；硬依赖在返回对象上声明 inject: ['名字']。
    // 例：const fs = ctx.get('fs')
    //     if (fs === undefined) return

    // Client → Host 的私有 RPC：
    // harness.handle('demo/hello', async (args) => { return { ok: true, ... } })
    // 注意：所有 handler 的入参/返回值必须是纯 JSON。
  },
}
