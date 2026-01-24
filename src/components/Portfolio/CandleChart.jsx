import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, AreaSeries } from 'lightweight-charts';

const CandleChart = ({ assetId, title, onClose }) => {
    const chartContainerRef = useRef();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!assetId) return;

        let chart;
        const fetchHistory = async () => {
            try {
                setLoading(true);
                // Polymarket CLOB API endpoint for history
                // params: interval (1m, 1h, 1d), market (asset_id)
                const response = await fetch(`/clob/prices-history?interval=1h&market=${assetId}`);

                if (!response.ok) {
                    throw new Error('Failed to fetch history');
                }

                const data = await response.json();

                if (!data.history || data.history.length === 0) {
                    // Try fallback or just show empty
                    // Some endpoints return array directly or object with history
                    if (Array.isArray(data)) {
                        // handle array
                    } else {
                        throw new Error('No history data found');
                    }
                }

                // Check data format
                const firstItem = data.history[0];
                const isCandle = firstItem.o !== undefined;

                let chartData = [];
                if (isCandle) {
                    chartData = data.history.map(item => ({
                        time: item.t,
                        open: parseFloat(item.o),
                        high: parseFloat(item.h),
                        low: parseFloat(item.l),
                        close: parseFloat(item.c),
                    }))
                        .filter(c =>
                            c.time && !isNaN(c.time) &&
                            !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close)
                        )
                        .sort((a, b) => a.time - b.time);
                } else {
                    // Assume 'p' for price (Line/Area chart)
                    chartData = data.history.map(item => ({
                        time: item.t,
                        value: parseFloat(item.p || 0),
                    }))
                        .filter(c => c.time && !isNaN(c.time) && !isNaN(c.value))
                        .sort((a, b) => a.time - b.time);
                }

                // Initialize Chart
                if (chartContainerRef.current) {
                    chart = createChart(chartContainerRef.current, {
                        layout: {
                            background: { type: ColorType.Solid, color: '#0f172a' }, // Slate-900
                            textColor: '#94a3b8',
                        },
                        grid: {
                            vertLines: { color: '#334155' },
                            horzLines: { color: '#334155' },
                        },
                        width: chartContainerRef.current.clientWidth,
                        height: 400,
                        timeScale: {
                            timeVisible: true,
                            secondsVisible: false,
                        },
                    });

                    let series;
                    if (isCandle) {
                        series = chart.addSeries(CandlestickSeries, {
                            upColor: '#10b981',
                            downColor: '#ef4444',
                            borderUpColor: '#10b981',
                            borderDownColor: '#ef4444',
                            wickUpColor: '#10b981',
                            wickDownColor: '#ef4444',
                        });
                    } else {
                        series = chart.addSeries(AreaSeries, {
                            lineColor: '#2962FF',
                            topColor: 'rgba(41, 98, 255, 0.3)',
                            bottomColor: 'rgba(41, 98, 255, 0)',
                        });
                    }

                    // Eliminate duplicates or invalid times
                    const uniqueData = [];
                    const timeSet = new Set();
                    chartData.forEach(c => {
                        if (!timeSet.has(c.time)) {
                            timeSet.add(c.time);
                            uniqueData.push(c);
                        }
                    });

                    series.setData(uniqueData);
                    chart.timeScale().fitContent();
                }
                setLoading(false);

            } catch (err) {
                console.error("Chart Error:", err);
                setError(err.message);
                setLoading(false);
            }
        };

        fetchHistory();

        const handleResize = () => {
            if (chart) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (chart) chart.remove();
        };
    }, [assetId]);

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999
        }} onClick={onClose}>
            <div style={{
                width: '90%',
                maxWidth: '900px',
                backgroundColor: '#0f172a',
                borderRadius: '12px',
                padding: '20px',
                position: 'relative',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
            }} onClick={e => e.stopPropagation()}>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <div>
                        <h3 style={{ margin: 0, color: 'white' }}>{title}</h3>
                        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.9rem' }}>1 Hour Candles</p>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            fontSize: '1.5rem',
                            cursor: 'pointer'
                        }}
                    >
                        ✕
                    </button>
                </div>

                <div
                    ref={chartContainerRef}
                    style={{ width: '100%', height: '400px', position: 'relative' }}
                >
                    {loading && (
                        <div style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            color: '#e2e8f0'
                        }}>
                            Loading Chart...
                        </div>
                    )}
                    {error && (
                        <div style={{
                            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                            color: '#ef4444'
                        }}>
                            Error: {error}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CandleChart;
