import io
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import seaborn as sns
import numpy as np
import chess
import chess.svg
import logging

logger = logging.getLogger(__name__)


class VisualizationService:
    def render_board_with_arrows(self, board, moves=None, last_move=None, flip=False):
        arrows = []
        if moves:
            for move in moves:
                try:
                    if isinstance(move, str):
                        move = chess.Move.from_uci(move)
                    arrows.append(chess.svg.Arrow(move.from_square, move.to_square, color="#4488ff"))
                except Exception:
                    pass

        if last_move:
            try:
                if isinstance(last_move, str):
                    last_move = chess.Move.from_uci(last_move)
                arrows.append(chess.svg.Arrow(last_move.from_square, last_move.to_square, color="#44bb44"))
            except Exception:
                pass

        return chess.svg.board(board=board, arrows=arrows, flipped=flip, size=400)

    def generate_control_heatmap(self, board, perspective=chess.WHITE):
        data = [[0] * 8 for _ in range(8)]
        for square in chess.SQUARES:
            row, col = 7 - (square // 8), square % 8
            data[row][col] = len(board.attackers(perspective, square))
        return data

    def generate_piece_influence_map(self, board):
        data = [[0] * 8 for _ in range(8)]
        for square in chess.SQUARES:
            row, col = 7 - (square // 8), square % 8
            w = len(board.attackers(chess.WHITE, square))
            b = len(board.attackers(chess.BLACK, square))
            data[row][col] = w - b
        return data

    def plot_heatmap(self, data, title="Heatmap", perspective="White"):
        """Render a heatmap and return PNG bytes (no temp files)."""
        try:
            buf = io.BytesIO()
            fig, ax = plt.subplots(figsize=(6, 6))

            cmap = {"White": "Greens", "Black": "Purples"}.get(perspective, "coolwarm")

            sns.heatmap(
                data,
                cmap=cmap,
                annot=True,
                fmt="d",
                linewidths=0.5,
                square=True,
                cbar=True,
                ax=ax,
            )

            ax.set_title(title)
            ax.set_xticklabels(["a", "b", "c", "d", "e", "f", "g", "h"])
            ax.set_yticklabels(["8", "7", "6", "5", "4", "3", "2", "1"])

            fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
            plt.close(fig)
            buf.seek(0)
            return buf.getvalue()
        except Exception as e:
            logger.error("Error plotting heatmap: %s", e)
            return None

    def plot_eval_graph(self, moves_data: list):
        """Plot centipawn evaluation over the game. Returns PNG bytes."""
        if not moves_data:
            return None
        try:
            scores = []
            x_labels = []
            blunder_x, blunder_y = [], []
            mistake_x, mistake_y = [], []
            strong_x, strong_y = [], []

            for i, m in enumerate(moves_data):
                raw = m.get("score_after")
                score = max(-1000, min(1000, raw if raw is not None else 0)) / 100.0
                scores.append(score)
                move_num = m["move_number"]
                color_char = "W" if m["color"] == "White" else "B"
                x_labels.append(f"{move_num}{color_char}")

                cls = m["classification"]
                if "Blunder" in cls:
                    blunder_x.append(i); blunder_y.append(score)
                elif "Mistake" in cls:
                    mistake_x.append(i); mistake_y.append(score)
                elif "Strong" in cls:
                    strong_x.append(i); strong_y.append(score)

            x = np.arange(len(scores))
            scores_arr = np.array(scores)

            fig, ax = plt.subplots(figsize=(10, 3))
            ax.plot(x, scores_arr, color="#2266cc", linewidth=1.5, zorder=3)
            ax.fill_between(x, scores_arr, 0,
                            where=(scores_arr >= 0), alpha=0.25, color="#cccccc", interpolate=True)
            ax.fill_between(x, scores_arr, 0,
                            where=(scores_arr < 0), alpha=0.25, color="#333333", interpolate=True)
            ax.axhline(0, color="black", linewidth=0.8)

            if blunder_x:
                ax.scatter(blunder_x, blunder_y, color="red", zorder=5, s=50, marker="*",
                           label="Blunder ??")
            if mistake_x:
                ax.scatter(mistake_x, mistake_y, color="orange", zorder=5, s=30, marker="o",
                           label="Mistake ?")
            if strong_x:
                ax.scatter(strong_x, strong_y, color="green", zorder=5, s=30, marker="^",
                           label="Strong !!")

            tick_step = max(1, len(x) // 20)
            ax.set_xticks(x[::tick_step])
            ax.set_xticklabels(x_labels[::tick_step], rotation=45, fontsize=7)
            ax.set_ylabel("Eval (pawns)")
            ax.set_title("Game Evaluation")
            ax.set_ylim(-11, 11)
            ax.grid(axis="y", linestyle="--", linewidth=0.5, alpha=0.5)

            if blunder_x or mistake_x or strong_x:
                ax.legend(fontsize=7, loc="upper right")

            fig.tight_layout()
            buf = io.BytesIO()
            fig.savefig(buf, format="png", dpi=100, bbox_inches="tight")
            plt.close(fig)
            buf.seek(0)
            return buf.getvalue()
        except Exception as e:
            logger.error("Error plotting eval graph: %s", e)
            return None
