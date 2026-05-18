import { FinancialKpis } from "@/components/widgets/FinancialKpis"
import { OperationalKpis } from "@/components/widgets/OperationalKpis"
import { SalesChart } from "@/components/widgets/SalesChart"
import { TopGroups } from "@/components/widgets/TopGroups"
import { StockAlerts } from "@/components/widgets/StockAlerts"
import { ResumenFinancieroCard } from "@/components/widgets/ResumenFinancieroCard"
import { RecentOrders } from "@/components/widgets/RecentOrders"
import { ActivityFeed } from "@/components/widgets/ActivityFeed"
import { CashProjection } from "@/components/widgets/CashProjection"

export default function DashboardPage() {
  return (
    <>
      <div className="px-4 lg:px-6">
        <FinancialKpis />
      </div>
      <div className="px-4 lg:px-6">
        <OperationalKpis />
      </div>
      <div className="px-4 lg:px-6 grid grid-cols-1 @4xl/main:grid-cols-3 gap-4 md:gap-6">
        <div className="@4xl/main:col-span-2"><SalesChart /></div>
        <TopGroups />
      </div>
      <div className="px-4 lg:px-6">
        <CashProjection />
      </div>
      <div className="px-4 lg:px-6 grid grid-cols-1 @4xl/main:grid-cols-2 gap-4 md:gap-6">
        <StockAlerts />
        <ResumenFinancieroCard />
      </div>
      <div className="px-4 lg:px-6 grid grid-cols-1 @4xl/main:grid-cols-3 gap-4 md:gap-6">
        <div className="@4xl/main:col-span-2"><RecentOrders /></div>
        <ActivityFeed />
      </div>
    </>
  )
}
