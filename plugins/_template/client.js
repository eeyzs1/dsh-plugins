return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    // 1) 注册 UI 前先查槽位：Slots.listSubTree 选目标，再查该槽位的完整协议。
    // 2) 用 React.createElement（无 JSX）；调用 Host RPC 用 host.call('demo/hello', {...})。
    // 例：
    // slots.inject('conversation.input.left', () => slots.register(
    //   { name: 'conversation.input.left', id: 'demo-btn', label: '示例' },
    //   (props) => React.createElement('button', { onClick: () => {} }, '示例'),
    // ))
  },
}
