const foundations = [
  '外部市场 Provider Adapter',
  '本地统一市场模型',
  '不可变虚拟积分账本',
  '报价、预测、持仓与结算边界',
  'Transactional Outbox',
  '审计、功能开关与诊断体系',
];

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <p className="eyebrow">ENGINEERING BASELINE · V0.1</p>
        <h1>Event Forecast Lab</h1>
        <p className="lead">
          一个面向长期演进设计的娱乐型事件预测平台。当前版本只建立可靠底座，不处理真实资金。
        </p>
      </section>

      <section className="panel">
        <h2>首批架构能力</h2>
        <ul>
          {foundations.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>下一施工节点</h2>
        <p>完成数据库迁移、市场同步落库、后台市场审核与第一个“免费积分模拟预测”闭环。</p>
      </section>
    </main>
  );
}
