#include "http/request_budget.hpp"

#include <lorica/checked_size.hpp>

namespace tr::http {

std::optional<lorica::budget_limits> request_budget_limits(const RequestBudgetSpec& spec) {
    const auto body3 = lorica::checked_multiply(spec.body_limit, 3);
    const auto with_header = body3 ? lorica::checked_add(*body3, spec.header_limit) : std::nullopt;
    const auto bytes = with_header ? lorica::checked_add(*with_header, 64 * 1024) : std::nullopt;
    const auto elements = lorica::checked_add(spec.json_elements, kMaxHeaderFields);
    const auto twice = elements ? lorica::checked_multiply(*elements, 2) : std::nullopt;
    const auto allocations = twice ? lorica::checked_add(*twice, 16) : std::nullopt;
    if (!bytes || !elements || !allocations) return std::nullopt;
    return lorica::budget_limits{*bytes, *elements, *allocations, spec.max_depth};
}

bool charge_headers(lorica::input_budget& budget, const std::vector<std::pair<std::string, std::string>>& fields) {
    if (fields.size() > kMaxHeaderFields) return false;
    std::size_t bytes = 0;
    for (const auto& [name, value] : fields) {
        const auto one = lorica::checked_add(name.size(), value.size());
        const auto line = one ? lorica::checked_add(*one, 4) : std::nullopt;  // ": " と CRLF
        const auto sum = line ? lorica::checked_add(bytes, *line) : std::nullopt;
        if (!sum) return false;
        bytes = *sum;
    }
    return budget.consume(bytes, fields.size(), 1);
}

bool charge_body(lorica::input_budget& budget, std::string_view body) { return budget.consume(body.size(), 0, 1); }

}  // namespace tr::http
