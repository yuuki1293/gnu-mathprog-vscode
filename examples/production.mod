# Standalone production planning example. Expected profit: 260.
set PRODUCTS;
param profit{PRODUCTS} >= 0;
param hours{PRODUCTS} > 0;
param available >= 0;
var quantity{PRODUCTS} >= 0, integer;
maximize Profit: sum {p in PRODUCTS} profit[p] * quantity[p];
subject to Capacity: sum {p in PRODUCTS} hours[p] * quantity[p] <= available;
solve;
display quantity, Profit;
data;
set PRODUCTS := chair table;
param : profit hours :=
  chair 20 2
  table 35 4;
param available := 26;
end;
