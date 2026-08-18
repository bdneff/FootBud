import type { DecisionTree } from '../engine/decisionTree';

export function DecisionTreeView({ tree }: { tree: DecisionTree | null }) {
  if (!tree || tree.branches.length === 0) return null;
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  return (
    <>
      <div className="section-title">
        Decision tree (pick {tree.decidingPick}
        {tree.followUpPick !== null ? `, then pick ${tree.followUpPick}` : ''})
      </div>
      <div className="decision-tree">
        {tree.branches.map((branch, i) => (
          <div key={branch.pickNow.playerId} className={i === 0 ? 'tree-branch best' : 'tree-branch'}>
            <div className="tree-root">
              <span className={`pos-dot pos-${branch.pickNow.position}`} />
              <strong>Draft {branch.pickNow.name}</strong>
              <span className="tree-ev">
                EV {branch.expectedValue.toFixed(0)}
                {i === 0 && <span className="tree-best-tag"> best</span>}
              </span>
            </div>
            {branch.leaves.map((leaf) => (
              <div key={leaf.outcome} className="tree-leaf">
                <span className="tree-connector">{leaf.outcome === 'survives' ? '├─' : '└─'}</span>
                {leaf.outcome === 'survives' && leaf.player ? (
                  <span>
                    {leaf.player.name} survives ({pct(leaf.probability)}) -&gt; take him (VOLS{' '}
                    {leaf.value.toFixed(0)})
                  </span>
                ) : (
                  <span>
                    {branch.target?.name ?? 'Target'} gone ({pct(leaf.probability)}) -&gt; best{' '}
                    {leaf.fallbackPosition ?? 'available'} expected (VOLS {leaf.value.toFixed(0)})
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="hint">
        EV is this pick's value over replacement plus the probability-weighted value of the planned
        follow-up. Only strategically meaningful branches are shown.
      </p>
    </>
  );
}
