"""Plotly figures use explicit axes, readable labels and no external assets."""
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots

TEAL = "#087f8c"
NAVY = "#233b60"
COLORS = [TEAL, NAVY, "#d17c38", "#5b6fb3", "#ae5364", "#568678", "#9c8b60", "#8895a5"]
CONFIG = {"displaylogo": False, "toImageButtonOptions": {"format": "svg", "filename": "research-figure"}}


def style(figure, title, height=380):
    figure.update_layout(title=dict(text=title, font=dict(size=17)), template="plotly_white", height=height,
                         font=dict(family="Arial, sans-serif", size=12, color=NAVY),
                         margin=dict(l=25,r=25,t=65,b=45), colorway=COLORS,
                         paper_bgcolor="white", plot_bgcolor="white", legend_title_text="")
    return figure


def bars(data, x, y, title, horizontal=False, color=None, height=400):
    figure = px.bar(data, x=x, y=y, color=color, orientation="h" if horizontal else "v",
                    color_discrete_sequence=COLORS, hover_data=data.columns.tolist())
    if horizontal:
        figure.update_yaxes(autorange="reversed")
        if y == "Test name":
            figure.update_yaxes(tickmode="array", tickvals=data[y], ticktext=[name[:44] + "…" if len(name) > 45 else name for name in data[y]])
    if y == "Healing success rate":
        figure.update_yaxes(tickformat=".0%", range=[0,1])
    return style(figure, title, height)


def failure_pie(data):
    values = data[data["Failures"] > 0]
    return style(px.pie(values, names="Failure type", values="Failures", hole=.62, color_discrete_sequence=COLORS), "Share of observed failures")


def trend(data):
    figure = make_subplots(specs=[[{"secondary_y": True}]])
    figure.add_trace(go.Scatter(x=data["Time"], y=data["Failures"], name="Failed attempts", mode="lines+markers", line=dict(color=NAVY)), secondary_y=False)
    figure.add_trace(go.Scatter(x=data["Time"], y=data["Failure rate"], name="Failure rate", mode="lines+markers", connectgaps=False, line=dict(color=TEAL)), secondary_y=True)
    figure.update_yaxes(title_text="Failed attempts", secondary_y=False)
    figure.update_yaxes(title_text="Failure rate", tickformat=".0%", rangemode="tozero", secondary_y=True)
    figure.update_xaxes(title_text="Execution start time (UTC)")
    figure.update_layout(legend=dict(orientation="h", y=-.3))
    return style(figure, "Failure trend · empty intervals have no rate", 400)


def risk_distribution(data):
    figure = px.histogram(data.dropna(subset=["Risk score"]), x="Risk score", nbins=10, color_discrete_sequence=[TEAL])
    figure.update_xaxes(range=[0,100], title_text="Historical heuristic risk score (0–100)")
    figure.update_yaxes(title_text="Scored test groups")
    return style(figure, "Risk score distribution")


def matrix(values):
    figure = go.Figure(go.Heatmap(z=values, x=["Predicted PASS", "Predicted FAIL"], y=["Actual PASS", "Actual FAIL"],
                                colorscale=[[0,"#eef5f7"],[1,TEAL]], text=values, texttemplate="%{text}", showscale=False,
                                hovertemplate="%{y}<br>%{x}<br>Count: %{z}<extra></extra>"))
    figure.update_yaxes(autorange="reversed")
    return style(figure, "Confusion matrix · failure is the positive class")


def pr_curve(curve):
    figure = go.Figure(go.Scatter(x=curve["recall"], y=curve["precision"], mode="lines", line=dict(color=TEAL, width=3)))
    figure.update_xaxes(title_text="Recall", range=[0,1.02])
    figure.update_yaxes(title_text="Precision", range=[0,1.02])
    return style(figure, "Precision–recall curve · measured holdout")


def cohort_heatmap(frame):
    counts = frame.groupby(["cohort", "status"]).size().unstack(fill_value=0)
    return style(go.Figure(go.Heatmap(z=counts.values, x=counts.columns, y=counts.index, colorscale="Blues",
                                     text=counts.values, texttemplate="%{text}", showscale=False)), "Attempt status by evidence cohort")
