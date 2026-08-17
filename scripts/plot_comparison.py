"""
Generates a side-by-side comparison bar chart of Baseline vs Our Model.
Saves the chart to the project root for the professor review.
"""
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import numpy as np

# ── Results ──────────────────────────────────────────────
baseline = {'RMSE': 6.5289, 'MAE': 5.1703, 'R²': 0.3322}
ours     = {'RMSE': 2.5200, 'MAE': 1.9063, 'R²': 0.9017}

metrics  = ['RMSE', 'MAE', 'R²']
bl_vals  = [baseline[m] for m in metrics]
our_vals = [ours[m]     for m in metrics]

# ── Plot ─────────────────────────────────────────────────
fig, axes = plt.subplots(1, 3, figsize=(14, 6))
fig.patch.set_facecolor('#0f1117')

colors_bl  = '#e05c5c'
colors_our = '#4ecdc4'

for i, (ax, metric, bv, ov) in enumerate(zip(axes, metrics, bl_vals, our_vals)):
    ax.set_facecolor('#1a1d27')
    ax.spines[['top','right','left','bottom']].set_color('#2e3250')
    ax.tick_params(colors='#aab0cc')

    bars = ax.bar(['Baseline\n(Random Forest)', 'Our Model\n(Multi-Modal)'],
                  [bv, ov],
                  color=[colors_bl, colors_our],
                  width=0.45,
                  edgecolor='#ffffff22',
                  linewidth=0.5)

    # Value labels on bars
    for bar, val in zip(bars, [bv, ov]):
        ax.text(bar.get_x() + bar.get_width() / 2,
                bar.get_height() + (max(bv, ov) * 0.02),
                f'{val:.4f}',
                ha='center', va='bottom',
                fontsize=11, fontweight='bold', color='white')

    # Improvement annotation
    if metric in ('RMSE', 'MAE'):
        pct = (bv - ov) / bv * 100
        label = f'↓ {pct:.1f}% better'
    else:
        pct = (ov - bv) / abs(bv) * 100
        label = f'↑ {pct:.1f}% better'
    ax.set_title(f'{metric}\n{label}',
                 color='white', fontsize=13, fontweight='bold', pad=12)

    ax.set_ylim(0, max(bv, ov) * 1.25)
    ax.yaxis.label.set_color('#aab0cc')
    ax.set_xticklabels(['Baseline\n(Random Forest)', 'Our Model\n(Multi-Modal)'],
                       fontsize=10, color='white')
    ax.set_yticks([])

# Legend
bl_patch  = mpatches.Patch(color=colors_bl,  label='Baseline – Random Forest (Vocal Only)')
our_patch = mpatches.Patch(color=colors_our, label='Our Model – Multi-Modal Fusion CNN')
fig.legend(handles=[bl_patch, our_patch], loc='lower center', ncol=2,
           frameon=False, fontsize=11, labelcolor='white')

fig.suptitle("Parkinson's UPDRS Prediction – Model Comparison",
             color='white', fontsize=16, fontweight='bold', y=1.02)

SAVE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'model_comparison.png')

plt.tight_layout(rect=[0, 0.06, 1, 1])
plt.savefig(SAVE_PATH, dpi=150, bbox_inches='tight', facecolor='#0f1117')
plt.close()
print(f"Saved comparison chart to {SAVE_PATH}")
